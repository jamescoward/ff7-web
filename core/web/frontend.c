/*
 * libretro frontend for the browser build of the PCSX ReARMed core.
 *
 * Original ff7-web project code (GPL-2.0-or-later, to match the core it links
 * with). It uses only the libretro API header (MIT, from the pinned upstream
 * tree, not vendored here).
 *
 * It mirrors runner/frontend.c (the headless frontend) and adds what a player
 * needs: the audio samples of each frame are kept for the page to play, and
 * the slot 1 memory card is exposed so the page can persist, import and
 * export it. The JS side (web/js/emu-worker.js) converts and posts the video
 * frame; this file only records where it is.
 */
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include <emscripten/emscripten.h>

#include "libretro.h"

#define KEEP EMSCRIPTEN_KEEPALIVE
#define MAX_PORTS 2
#define MAX_OPTS 64
/* Stereo frames kept between two fe_audio_take calls. One NTSC video frame
 * carries ~736 at 44.1 kHz; the page drains after every batch of frames. */
#define AUDIO_CAP 16384

static uint16_t pad_mask[MAX_PORTS];

static const void *fb_data;
static unsigned fb_width, fb_height;
static size_t fb_pitch;
static enum retro_pixel_format pixel_format = RETRO_PIXEL_FORMAT_0RGB1555;

static int16_t audio_buf[AUDIO_CAP * 2];
static uint32_t audio_count;   /* stereo frames in audio_buf */
static uint32_t audio_dropped; /* frames lost because the page didn't drain */

static int verbose;
static char opt_keys[MAX_OPTS][96];
static char opt_vals[MAX_OPTS][128];
static int opt_count;

static void log_cb(enum retro_log_level level, const char *fmt, ...)
{
   va_list ap;
   if (!verbose && level < RETRO_LOG_WARN)
      return;
   va_start(ap, fmt);
   vfprintf(stderr, fmt, ap);
   va_end(ap);
}

static bool env_cb(unsigned cmd, void *data)
{
   switch (cmd)
   {
   case RETRO_ENVIRONMENT_GET_CAN_DUPE:
      /* Duped frames would leave nothing new to draw; the page keeps the
       * last picture anyway, so ask for a pointer every frame (simpler). */
      *(bool *)data = false;
      return true;
   case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
   {
      enum retro_pixel_format f = *(const enum retro_pixel_format *)data;
      if (f != RETRO_PIXEL_FORMAT_0RGB1555 && f != RETRO_PIXEL_FORMAT_RGB565 &&
          f != RETRO_PIXEL_FORMAT_XRGB8888)
         return false;
      pixel_format = f;
      return true;
   }
   case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
      /* An empty directory: no BIOS file, so the core uses its HLE BIOS. */
      *(const char **)data = "/system";
      return true;
   case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
      *(const char **)data = "/save";
      return true;
   case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
      return true;
   case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
      ((struct retro_log_callback *)data)->log = log_cb;
      return true;
   case RETRO_ENVIRONMENT_GET_VARIABLE:
   {
      struct retro_variable *var = data;
      int i;
      var->value = NULL;
      for (i = 0; i < opt_count; i++)
         if (var->key && strcmp(var->key, opt_keys[i]) == 0)
         {
            var->value = opt_vals[i];
            return true;
         }
      return false;
   }
   case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
      *(bool *)data = false;
      return true;
   default:
      return false;
   }
}

static void video_cb(const void *data, unsigned width, unsigned height, size_t pitch)
{
   if (!data)
      return;
   fb_data = data;
   fb_width = width;
   fb_height = height;
   fb_pitch = pitch;
}

static void push_audio(const int16_t *data, size_t frames)
{
   size_t room = AUDIO_CAP - audio_count;
   if (frames > room)
   {
      audio_dropped += (uint32_t)(frames - room);
      frames = room;
   }
   memcpy(audio_buf + audio_count * 2, data, frames * 2 * sizeof(int16_t));
   audio_count += (uint32_t)frames;
}

static void audio_sample_cb(int16_t left, int16_t right)
{
   int16_t s[2] = { left, right };
   push_audio(s, 1);
}

static size_t audio_batch_cb(const int16_t *data, size_t frames)
{
   push_audio(data, frames);
   return frames;
}

static void input_poll_cb(void) {}

static int16_t input_state_cb(unsigned port, unsigned device, unsigned index, unsigned id)
{
   (void)index;
   if (port >= MAX_PORTS || device != RETRO_DEVICE_JOYPAD)
      return 0;
   if (id == RETRO_DEVICE_ID_JOYPAD_MASK)
      return (int16_t)pad_mask[port];
   if (id <= RETRO_DEVICE_ID_JOYPAD_R3)
      return (pad_mask[port] >> id) & 1;
   return 0;
}

KEEP int fe_init(int verbose_log)
{
   verbose = verbose_log;
   mkdir("/system", 0755);
   mkdir("/save", 0755);
   retro_set_environment(env_cb);
   retro_set_video_refresh(video_cb);
   retro_set_audio_sample(audio_sample_cb);
   retro_set_audio_sample_batch(audio_batch_cb);
   retro_set_input_poll(input_poll_cb);
   retro_set_input_state(input_state_cb);
   retro_init();
   return (int)retro_api_version();
}

/* Core options must be set before fe_load_game to take effect. */
KEEP int fe_set_option(const char *key, const char *value)
{
   int i;
   if (strlen(key) >= sizeof(opt_keys[0]) || strlen(value) >= sizeof(opt_vals[0]))
      return 0;
   for (i = 0; i < opt_count; i++)
      if (strcmp(key, opt_keys[i]) == 0)
         break;
   if (i == MAX_OPTS)
      return 0;
   strcpy(opt_keys[i], key);
   strcpy(opt_vals[i], value);
   if (i == opt_count)
      opt_count++;
   return 1;
}

KEEP int fe_load_game(const char *path)
{
   struct retro_game_info info;
   unsigned port;
   memset(&info, 0, sizeof(info));
   info.path = path;
   if (!retro_load_game(&info))
      return 0;
   for (port = 0; port < MAX_PORTS; port++)
      retro_set_controller_port_device(port, RETRO_DEVICE_JOYPAD);
   return 1;
}

KEEP void fe_run_frame(void) { retro_run(); }
KEEP void fe_reset(void) { retro_reset(); }
KEEP void fe_unload(void) { retro_unload_game(); }

KEEP void fe_set_pad(unsigned port, unsigned mask)
{
   if (port < MAX_PORTS)
      pad_mask[port] = (uint16_t)mask;
}

KEEP const void *fe_fb_data(void) { return fb_data; }
KEEP unsigned fe_fb_width(void) { return fb_width; }
KEEP unsigned fe_fb_height(void) { return fb_height; }
KEEP unsigned fe_fb_pitch(void) { return (unsigned)fb_pitch; }
KEEP int fe_fb_format(void) { return (int)pixel_format; }

/* Audio: interleaved stereo int16 at fe_sample_rate(). The page reads
 * fe_audio_count() frames from fe_audio_ptr(), then calls fe_audio_clear(). */
KEEP const int16_t *fe_audio_ptr(void) { return audio_buf; }
KEEP uint32_t fe_audio_count(void) { return audio_count; }
KEEP void fe_audio_clear(void) { audio_count = 0; }
KEEP uint32_t fe_audio_dropped(void) { return audio_dropped; }

KEEP void *fe_ram_ptr(void) { return retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM); }
KEEP unsigned fe_ram_size(void) { return (unsigned)retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM); }

/* Slot 1 memory card (raw 128 KiB), present when pcsx_rearmed_memcard1 is
 * "libretro". As in any libretro frontend, the page fills it after a load. */
KEEP void *fe_card_ptr(void) { return retro_get_memory_data(RETRO_MEMORY_SAVE_RAM); }
KEEP unsigned fe_card_size(void) { return (unsigned)retro_get_memory_size(RETRO_MEMORY_SAVE_RAM); }

static struct retro_system_av_info av_info(void)
{
   struct retro_system_av_info av;
   memset(&av, 0, sizeof(av));
   retro_get_system_av_info(&av);
   return av;
}

KEEP double fe_fps(void) { return av_info().timing.fps; }
KEEP double fe_sample_rate(void) { return av_info().timing.sample_rate; }
