// ================================================================
// AnimeWorld India — Fixed & Improved for Nuvio
// Domains: watchanimeworld.net + play.zephyrflick.top
// ================================================================

var TMDB_KEY = "d80ba92bc7cefe3359668d30d06f3305";
var BASE     = "https://watchanimeworld.net";
var PLAYER   = "https://play.zephyrflick.top";
var UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function httpGet(url, extraHeaders) {
  var headers = Object.assign({ "User-Agent": UA }, extraHeaders || {});
  return fetch(url, { headers: headers }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}

function httpPost(url, body, extraHeaders) {
  var headers = Object.assign({
    "User-Agent": UA,
    "Content-Type": "application/x-www-form-urlencoded"
  }, extraHeaders || {});
  return fetch(url, {
    method: "POST",
    headers: headers,
    body: body
  }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
}

function searchSite(title, mediaType) {
  var searchUrl = BASE + "/?s=" + encodeURIComponent(title);
  return httpGet(searchUrl, { Referer: BASE + "/" }).then(function (html) {
    var results = [];
    var re = /href="(https?:\/\/[^"]+\/(series|movies)\/([^\/"]+)\/)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var url = m[1];
      var type = m[2];
      var slug = m[3];
      if (slug && slug !== "page") {
        results.push({ url: url, type: type, slug: slug });
      }
    }
    if (mediaType === "movie") {
      return results.filter(function (r) { return r.type === "movies"; });
    }
    return results.filter(function (r) { return r.type === "series"; });
  });
}

function getEpisodeUrl(seriesUrl, season, episode) {
  return httpGet(seriesUrl, { Referer: BASE + "/" }).then(function (html) {
    var postMatch = html.match(/postid-(\d+)/) || html.match(/data-post="(\d+)"/);
    var epPattern = season + "x" + episode;

    // First try AJAX season load
    if (postMatch) {
      var postId = postMatch[1];
      var ajaxUrl = BASE + "/wp-admin/admin-ajax.php?action=action_select_season&season=" + season + "&post=" + postId;

      return httpGet(ajaxUrl, { Referer: seriesUrl }).then(function (ajaxHtml) {
        var epRe = /href="(https?:\/\/[^"]+\/episode\/([^"]+))"/g;
        var m;
        while ((m = epRe.exec(ajaxHtml || "")) !== null) {
          if (m[1].indexOf(epPattern) !== -1 || m[2].indexOf(epPattern) !== -1) {
            return m[1];
          }
        }
        // Fallback: search original page
        return findEpisodeInHtml(html, epPattern);
      }).catch(function () {
        return findEpisodeInHtml(html, epPattern);
      });
    }

    // No postid → direct search on page
    return findEpisodeInHtml(html, epPattern);
  });
}

function findEpisodeInHtml(html, epPattern) {
  var epRe = /href="(https?:\/\/[^"]+\/episode\/([^"]+))"/g;
  var m;
  while ((m = epRe.exec(html)) !== null) {
    if (m[1].indexOf(epPattern) !== -1 || m[2].indexOf(epPattern) !== -1) {
      return m[1];
    }
  }
  return null;
}

function getStreamFromPage(pageUrl) {
  return httpGet(pageUrl, { Referer: BASE + "/" }).then(function (html) {
    // Try multiple player patterns
    var playerMatch = html.match(/(?:src|data-src)="(https?:\/\/play\.[^"]+\/video\/([a-f0-9]+))"/i);
    
    if (!playerMatch) {
      playerMatch = html.match(/https?:\/\/play\.(zephyrflick|zephyrix)\.top\/video\/([a-f0-9]+)/i);
      if (playerMatch) {
        playerMatch = [null, "https://play.zephyrflick.top/video/" + playerMatch[2], playerMatch[2]];
      }
    }

    if (!playerMatch) return null;

    var videoId = playerMatch[2];

    return httpPost(
      PLAYER + "/player/index.php?data=" + videoId + "&do=getVideo",
      "hash=" + videoId + "&r=" + encodeURIComponent(BASE + "/"),
      {
        Referer: BASE + "/",
        Origin: PLAYER,
        "X-Requested-With": "XMLHttpRequest"
      }
    ).then(function (data) {
      var streamUrl = data.videoSource || data.securedLink || data.source || data.file || null;
      if (!streamUrl) return null;

      var contentHashM = streamUrl.match(/\/cdn\/hls\/([a-f0-9]+)\//);
      var contentHash  = contentHashM ? contentHashM[1] : videoId;
      var subtitle = PLAYER + "/cdn/down/" + contentHash + "/Subtitle/subtitle_eng.srt";

      return {
        url: streamUrl,
        subtitle: subtitle
      };
    }).catch(function () {
      return null;
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  return new Promise(function (resolve) {
    var tmdbUrl = "https://api.themoviedb.org/3/" +
      (mediaType === "movie" ? "movie" : "tv") +
      "/" + tmdbId + "?api_key=" + TMDB_KEY;

    fetch(tmdbUrl)
      .then(function (r) { return r.json(); })
      .then(function (meta) {
        var title = meta.title || meta.name;
        if (!title) throw new Error("No title from TMDB");

        return searchSite(title, mediaType).then(function (results) {
          if (!results || results.length === 0) return null;

          var pageUrl = results[0].url;

          if (mediaType === "movie") {
            return getStreamFromPage(pageUrl);
          }

          // Try requested season first, then force season 1 (many Indian sites put everything in S1)
          return getEpisodeUrl(pageUrl, season || 1, episode || 1)
            .then(function (epUrl) {
              if (epUrl) return getStreamFromPage(epUrl);

              // Fallback: try as season 1
              if (season && season !== 1) {
                return getEpisodeUrl(pageUrl, 1, episode || 1)
                  .then(function (epUrl2) {
                    return epUrl2 ? getStreamFromPage(epUrl2) : null;
                  });
              }
              return null;
            });
        });
      })
      .then(function (streamData) {
        if (!streamData || !streamData.url) {
          resolve([]);
          return;
        }

        resolve([{
          name: "AnimeWorld • 1080p",
          title: "AnimeWorld India",
          url: streamData.url,
          quality: "1080p",
          headers: {
            "User-Agent": UA,
            "Referer": PLAYER + "/",
            "Origin": PLAYER
          },
          provider: "animeworld",
          subtitles: streamData.subtitle ? [{
            url: streamData.subtitle,
            language: "en",
            name: "English"
          }] : []
        }]);
      })
      .catch(function (err) {
        console.error("[AnimeWorld Fixed]", err && err.message ? err.message : err);
        resolve([]);
      });
  });
}

// Export for Nuvio
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
