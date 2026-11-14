// The mirror's worker: turns the pictures read from the GPU into JPEGs and sends them to the hub.
//
// Why a worker: in an AR session the page's main thread is busy drawing every frame, and the
// browser encodes canvas pictures (toBlob) only when that thread is idle. On the Quest that
// made one picture take two to five seconds. Here nothing competes with the encoding, and the
// socket to the hub lives here too, so a slow network never holds up a frame.
//
// From the page:  { type: 'open', url }                         connect (and keep reconnecting)
//                 { type: 'frame', width, height, pixels, info }  pixels: RGBA as read from the GPU
//                                                                (rows bottom to top, linear light)
// To the page:    { type: 'viewers', n }   how many monitor pages are open (0 when not connected)
//                 { type: 'done' }         a frame was dealt with: the next one may come

const RETRY_MS = 5000;
const MAX_QUEUED_BYTES = 200000; // pictures are dropped, not queued, when the link is slower than the camera

/** Linear light 0-255 -> sRGB 0-255: a render target holds linear values, a JPEG wants sRGB. */
const TO_SRGB = Uint8ClampedArray.from({ length: 256 }, (_, i) => {
  const x = i / 255;
  return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
});

let ws = null;
let url = null;
let canvas = null;
let g = null;
let image = null;
let sentInfo = '';
let quality = 0.6;

function connect() {
  try {
    ws = new WebSocket(url);
  } catch {
    return; // a bad address: link.js has already said so
  }
  ws.onmessage = (ev) => {
    try {
      postMessage({ type: 'viewers', n: Number(JSON.parse(ev.data).viewers) || 0 });
    } catch {
      /* not for us */
    }
  };
  ws.onclose = () => {
    ws = null;
    sentInfo = '';
    postMessage({ type: 'viewers', n: 0 });
    setTimeout(connect, RETRY_MS);
  };
  ws.onerror = () => {}; // onclose follows
}

async function frame({ width, height, pixels, info }) {
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    g = canvas.getContext('2d');
    image = g.createImageData(width, height);
  }
  const src = new Uint8Array(pixels);
  const out = image.data;
  for (let y = 0; y < height; y++) {
    let s = (height - 1 - y) * width * 4;
    let d = y * width * 4;
    for (let x = 0; x < width; x++, s += 4, d += 4) {
      out[d] = TO_SRGB[src[s]];
      out[d + 1] = TO_SRGB[src[s + 1]];
      out[d + 2] = TO_SRGB[src[s + 2]];
      out[d + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount <= MAX_QUEUED_BYTES) {
    const text = JSON.stringify({ info });
    if (text !== sentInfo) ws.send((sentInfo = text));
    ws.send(blob);
  }
}

onmessage = ({ data }) => {
  if (data.type === 'open') {
    url = data.url;
    quality = data.quality ?? quality;
    connect();
  } else if (data.type === 'frame') {
    frame(data)
      .catch(() => {})
      .finally(() => postMessage({ type: 'done', pixels: data.pixels }, [data.pixels])); // the buffer goes back to be reused
  }
};
