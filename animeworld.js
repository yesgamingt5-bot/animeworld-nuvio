// AnimeWorld India scraper for Nuvio
// Target: https://watchanimeworld.one/ (and common mirrors)

var BASE = "https://watchanimeworld.one";
var PLAYER = "https://play.zephyrix.top";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var TMDB_KEY = "d80ba92bc7cefe3359668d30d06f3305";

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
    return r.text();
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
    if (!postMatch) {
      // Fallback: look for episode links directly
      var epPattern = season + "x" + episode;
      var epRe = /href="(https?:\/\/[^"]+\/episode\/([^"]+))"/g;
      var m;
      while ((m = epRe.exec(html)) !== null) {
        if (m[1].indexOf(epPattern) !== -1 || m[2].indexOf(epPattern) !== -1) {
          return m[1];
        }
      }
      return null;
    }

    var postId = postMatch[1];
    // Try common ajax pattern
    var ajaxUrl = BASE + "/wp-admin/admin-ajax.php?action=get_episodes&post=" + postId + "&season=" + season;
    return httpGet(ajaxUrl, { Referer: seriesUrl }).then(function (ajaxHtml) {
      var epPattern = season + "x" + episode;
      var epRe = /href="(https?:\/\/[^"]+\/episode\/([^"]+))"/g;
      var m;
      while ((m = epRe.exec(ajaxHtml || html)) !== null) {
        if (m[1].indexOf(epPattern) !== -1 || m[2].indexOf(epPattern) !== -1) {
          return m[1];
        }
      }
      // Final fallback on original page
      epRe = /href="(https?:\/\/[^"]+\/episode\/([^"]+))"/g;
      while ((m = epRe.exec(html)) !== null) {
        if (m[1].indexOf(epPattern) !== -1 || m[2].indexOf(epPattern) !== -1) {
          return m[1];
        }
      }
      return null;
    }).catch(function () {
      var epPattern = season + "x" + episode;
      var epRe = /href="(https?:\/\/[^"]+\/episode\/([^"]+))"/g;
      var m;
      while ((m = epRe.exec(html)) !== null) {
        if (m[1].indexOf(epPattern) !== -1 || m[2].indexOf(epPattern) !== -1) {
          return m[1];
        }
      }
      return null;
    });
  });
}

function getStreamFromPage(pageUrl) {
  return httpGet(pageUrl, { Referer: BASE + "/" }).then(function (html) {
    var playerMatch = html.match(/(?:src|data-src)="(https?:\/\/play\.[^"]+\/video\/([a-f0-9]+))"/i);
    if (!playerMatch) {
      playerMatch = html.match(/https?:\/\/play\.[a-z0-9.-]+\/video\/([a-f0-9]+)/i);
      if (playerMatch) {
        playerMatch = [null, "https://play.zephyrix.top/video/" + playerMatch[1], playerMatch[1]];
      }
    }
    if (!playerMatch) return null;

    var videoId = playerMatch[2];
    var postBody = "hash=" + videoId + "&r=" + encodeURIComponent(BASE + "/");

    return httpPost(
      PLAYER + "/player/index.php?data=" + videoId,
      postBody,
      {
        Referer: BASE + "/",
        Origin: PLAYER,
        "X-Requested-With": "XMLHttpRequest"
      }
    ).then(function (resp) {
      var data = {};
      try {
        data = JSON.parse(resp);
      } catch (e) {}
      var streamUrl = data.videoSource || data.source || data.file || null;
      if (!streamUrl) return null;

      var subtitle = PLAYER + "/cdn/hls/" + videoId + "/Subtitle/subtitle_eng.srt";

      return {
        url: streamUrl,
        subtitle: subtitle
      };
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

          return getEpisodeUrl(pageUrl, season || 1, episode || 1)
            .then(function (epUrl) {
              if (!epUrl) return null;
              return getStreamFromPage(epUrl);
            });
        });
      })
      .then(function (streamData) {
        if (!streamData || !streamData.url) {
          resolve([]);
          return;
        }

        var quality = "1080p";
        var name = "AnimeWorld • " + quality;

        resolve([{
          name: name,
          title: "AnimeWorld India",
          url: streamData.url,
          quality: quality,
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
        console.error("[AnimeWorld]", err && err.message ? err.message : err);
        resolve([]);
      });
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
