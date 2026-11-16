// 4-point homography -> CSS matrix3d.
// Maps a source rectangle (image pixels) onto arbitrary screen corners.

function adj(m) {
  // adjugate = transpose of cofactor matrix
  return [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ];
}

function multmm(a, b) {
  const c = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
      c[i * 3 + j] = s;
    }
  return c;
}

function multmv(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function basisToPoints(x1, y1, x2, y2, x3, y3, x4, y4) {
  const m = [x1, x2, x3, y1, y2, y3, 1, 1, 1];
  const v = multmv(adj(m), [x4, y4, 1]);
  return multmm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

// General 4-src-point -> 4-dst-point projective transform (3x3, row-major).
function homography2d(src, dst) {
  const s = basisToPoints(src[0][0], src[0][1], src[1][0], src[1][1], src[2][0], src[2][1], src[3][0], src[3][1]);
  const d = basisToPoints(dst[0][0], dst[0][1], dst[1][0], dst[1][1], dst[2][0], dst[2][1], dst[3][0], dst[3][1]);
  return multmm(d, adj(s));
}

// corners: [[x,y]x4] normalized screen coords, order TL,TR,BR,BL.
// Returns CSS matrix3d() string for an element of size w x h px.
function cssWarp(w, h, corners, vw, vh) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const dst = corners.map(([x, y]) => [x, y]);
  const m = homography2d(src, dst); // normalized -> normalized
  // element px -> normalized -> screen normalized -> screen px
  const toPx = [vw, 0, 0, 0, vh, 0, 0, 0, 1];
  const toNorm = [1 / w, 0, 0, 0, 1 / h, 0, 0, 0, 1];
  const t = multmm(toPx, multmm(m, toNorm));
  if (t[8] < 0) for (let i = 0; i < 9; i++) t[i] = -t[i]; // normalize: positive w
  const f = (v) => Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(8);
  return `matrix3d(${f(t[0])},${f(t[3])},0,${f(t[6])},${f(t[1])},${f(t[4])},0,${f(t[7])},0,0,1,0,${f(t[2])},${f(t[5])},0,${f(t[8])})`;
}
