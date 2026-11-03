/*
 * Minimal libretro frontend for headless runs of the PCSX ReARMed core.
 *
 * Original ff7-web project code (GPL-2.0-or-later, to match the core it links
 * with). It uses only the libretro API header (MIT, from the pinned upstream
 * tree, not vendored here).
 *
 * The frontend does no rendering and no audio output. It records the last
 * video frame for hashing, holds the pad state that the JS backend sets, and
 * answers the environment queries the core needs. Everything it reports is a
 * function of the loaded program and the pad inputs, so runs are repeatable.
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

static uint16_t pad_mask[MAX_PORTS];

static const void *fb_data;
static unsigned fb_width, fb_height;
static size_t fb_pitch;
static int fb_dupes; /* frames where the core passed NULL (no new picture) */
static enum retro_pixel_format pixel_format = RETRO_PIXEL_FORMAT_0RGB1555;

static uint32_t audio_frames;
static uint32_t input_polls;
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
      /* Always get a frame pointer back, so every frame can be hashed. */
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
   {
      fb_dupes++;
      return;
   }
   fb_data = data;
   fb_width = width;
   fb_height = height;
   fb_pitch = pitch;
}

static void audio_sample_cb(int16_t left, int16_t right)
{
   (void)left;
   (void)right;
   audio_frames++;
}

static size_t audio_batch_cb(const int16_t *data, size_t frames)
{
   (void)data;
   audio_frames += frames;
   return frames;
}

static void input_poll_cb(void)
{
   input_polls++;
}

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
KEEP void fe_deinit(void) { retro_deinit(); }

KEEP void fe_set_pad(unsigned port, unsigned mask)
{
   if (port < MAX_PORTS)
      pad_mask[port] = (uint16_t)mask;
}

/* Test hook: answer exactly as the core's input_state callback would. */
KEEP int fe_input_state(unsigned port, unsigned device, unsigned index, unsigned id)
{
   return input_state_cb(port, device, index, id);
}

KEEP const void *fe_fb_data(void) { return fb_data; }
KEEP unsigned fe_fb_width(void) { return fb_width; }
KEEP unsigned fe_fb_height(void) { return fb_height; }
KEEP unsigned fe_fb_pitch(void) { return (unsigned)fb_pitch; }
KEEP int fe_fb_format(void) { return (int)pixel_format; }
KEEP int fe_fb_dupes(void) { return fb_dupes; }

KEEP void *fe_ram_ptr(void) { return retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM); }
KEEP unsigned fe_ram_size(void) { return (unsigned)retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM); }

KEEP uint32_t fe_audio_frames(void) { return audio_frames; }
KEEP uint32_t fe_input_polls(void) { return input_polls; }

KEEP double fe_fps(void)
{
   struct retro_system_av_info av;
   memset(&av, 0, sizeof(av));
   retro_get_system_av_info(&av);
   return av.timing.fps;
}
