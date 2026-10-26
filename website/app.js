import './symbols.js';
import './demo.js';
import './downloads.js';
import './community.js';

// Preserve bookmarks to the release history before it moved off the homepage.
if (['#history', '#candidate-release'].includes(location.hash)) {
  location.replace('./releases.html' + location.hash);
}
