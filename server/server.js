/**
 * YT Playlist PWA — バックエンド API サーバー
 * Node.js (Express) + yt-dlp-exec
 *
 * エンドポイント:
 *   GET /api/playlist?url=<YouTubeプレイリストURL>
 *     → { tracks: [{title, videoId, thumbnail, duration}] }
 *
 *   GET /health
 *     → { status: "ok" }
 */

const express  = require('express');
const cors     = require('cors');
const ytDlp    = require('yt-dlp-exec');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ── CORS ────────────────────────────────────────────────────── */
// フロントエンドのオリジンを許可（本番では自分のVercelドメインに絞る）
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');

app.use(cors({
  origin: ALLOWED_ORIGINS.includes('*')
    ? '*'
    : (origin, cb) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
        else cb(new Error('CORS policy: origin not allowed'));
      },
  methods: ['GET'],
}));

app.use(express.json());

/* ── Health check ────────────────────────────────────────────── */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/* ── /api/playlist ───────────────────────────────────────────── */
app.get('/api/playlist', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'url パラメータが必要です' });
  }

  // YouTube URL かどうか簡易チェック
  if (!/youtube\.com|youtu\.be/.test(url)) {
    return res.status(400).json({ error: '有効な YouTube URL を指定してください' });
  }

  try {
    /**
     * yt-dlp でプレイリスト情報を取得
     *  --flat-playlist: 各動画を個別ダウンロードせず、メタデータのみ収集
     *  --dump-single-json: 全体を 1 つの JSON として出力
     */
    const raw = await ytDlp(url, {
      flatPlaylist:   true,
      dumpSingleJson: true,
      noWarnings:     true,
      noCallHome:     true,
      skipDownload:   true,
    });

    // プレイリスト全体 or 単一動画を正規化
    let entries = [];

    if (raw.entries && Array.isArray(raw.entries)) {
      // プレイリスト
      entries = raw.entries;
    } else if (raw.id) {
      // 単一動画がURLに含まれていた場合
      entries = [raw];
    } else {
      return res.status(422).json({ error: 'プレイリスト情報を解析できませんでした' });
    }

    const tracks = entries
      .filter(e => e && (e.id || e.url))   // 非公開/削除済みを除外
      .map(e => {
        const videoId  = e.id  || extractVideoId(e.url || '');
        const thumb    = bestThumbnail(e.thumbnails, e.thumbnail, videoId);
        return {
          title:     e.title     || videoId || '(タイトル不明)',
          videoId:   videoId,
          thumbnail: thumb,
          duration:  e.duration  || 0,      // 秒数
        };
      })
      .filter(t => t.videoId);             // videoId が取れないものは除外

    if (!tracks.length) {
      return res.status(422).json({ error: '再生可能なトラックが見つかりませんでした' });
    }

    return res.json({ tracks, total: tracks.length });

  } catch (err) {
    console.error('[/api/playlist] error:', err.message || err);

    // yt-dlp が見つからない or 実行エラー
    if (/yt-dlp/.test(err.message || '')) {
      return res.status(500).json({
        error: 'yt-dlp が見つかりません。npm install を実行してください。',
      });
    }

    // プライベート or 地域制限プレイリスト
    if (/Private|unavailable|Forbidden/.test(err.message || '')) {
      return res.status(403).json({ error: 'このプレイリストはアクセスできません（非公開または地域制限）' });
    }

    return res.status(500).json({ error: err.message || 'サーバー内部エラー' });
  }
});

/* ── Helpers ─────────────────────────────────────────────────── */

/**
 * thumbnails 配列 or 単一 URL から最適なサムネイルを選ぶ
 * 優先順: 480x360 → maxresdefault → hqdefault → fallback
 */
function bestThumbnail(thumbs, fallbackUrl, videoId) {
  // YouTube の標準サムネイル URL を直接返す（最も確実）
  if (videoId) {
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }
  if (fallbackUrl) return fallbackUrl;
  if (Array.isArray(thumbs) && thumbs.length) {
    // 解像度が中程度のものを優先
    const preferred = thumbs.find(t => t.width === 480 || t.height === 360);
    return preferred ? preferred.url : thumbs[0].url;
  }
  return '';
}

/** URL から videoId を正規表現で抽出 */
function extractVideoId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : '';
}

/* ── Start ───────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`✓ YT PWA API server listening on http://localhost:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
});
