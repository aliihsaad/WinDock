// Now-playing via the Windows media transport controls.
//
// GlobalSystemMediaTransportControlsSessionManager reports whatever app owns
// the current media session (Spotify, a browser tab, a local player), so the
// dock shows real track information instead of guessing from window titles.

using Windows.Media.Control;

namespace WinDock;

internal static class MediaSession
{
    public static object? Current()
    {
        try
        {
            var manager = GlobalSystemMediaTransportControlsSessionManager
                .RequestAsync().AsTask().GetAwaiter().GetResult();

            var session = manager?.GetCurrentSession();
            if (session is null) return null;

            var props = session.TryGetMediaPropertiesAsync()
                .AsTask().GetAwaiter().GetResult();
            if (props is null || string.IsNullOrWhiteSpace(props.Title)) return null;

            var playback = session.GetPlaybackInfo();
            var playing = playback?.PlaybackStatus
                == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;

            return new
            {
                title = props.Title,
                artist = props.Artist ?? string.Empty,
                playing,
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"nowplaying: {ex.Message}");
            return null;
        }
    }
}
