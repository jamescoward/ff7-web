# Try to open raw sockets (IP and packet level). Node can't do this without
# a native addon, but the pinned image ships perl. Records the errno for
# each attempt, or "ok" if a socket opened.
use strict;
use warnings;
use Socket;

my %r;
for my $try ([raw_inet => PF_INET, SOCK_RAW, 255], [raw_icmp => PF_INET, SOCK_RAW, 1], [packet => 17, SOCK_RAW, 0]) {
  my ($name, @args) = @$try;
  $r{$name} = socket(my $s, $args[0], $args[1], $args[2]) ? 'ok' : ($! + 0);
}
open my $f, '>', '/out/result.json' or die;
print $f '{' . join(',', map { qq("$_":"$r{$_}") } sort keys %r) . '}';
