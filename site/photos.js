// Dot Trading Post — photo handling, all of it in the browser before anything is uploaded.
//
// Two passes, lifted from cbay and ported from Node Buffers to plain Uint8Array/DataView:
//
//   1. compress — re-encode large photos through a canvas so a 12 MB phone picture becomes a
//      ~300 KB JPEG. Re-encoding also happens to drop metadata as a side effect, but only for
//      files big enough to go through it, so it is not relied on for that.
//
//   2. strip — remove EXIF / XMP / IPTC / text chunks from whatever is about to be uploaded. Phone
//      photos carry GPS coordinates, camera serial numbers and capture timestamps. The bucket is
//      public by design, so publishing a photo unstripped publishes where someone lives.
//
// JPEG: every APPn (FFE0–FFEF) and COM (FFFE) segment is dropped; SOI/SOF/DQT/DHT/DRI/SOS/EOI and
// the compressed scan stay. WebP: EXIF and XMP RIFF chunks dropped, the RIFF length rewritten.
// PNG: a strict allowlist of critical and colour chunks; everything else (text, time,
// fingerprinting, anything unfamiliar) is dropped. A buffer that is not a recognised format is
// returned unchanged so an upload is never corrupted — the MIME allowlist decides what is attempted.
(function () {
  "use strict";

  var ALLOWED = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var MAX_BYTES = 8 * 1024 * 1024;
  var MAX_PHOTOS = 4;

  function ascii(b, from, to) { return String.fromCharCode.apply(null, b.subarray(from, to)); }
  function concat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }

  function isJpeg(b) { return b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF; }
  function isPng(b)  { return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47; }
  function isWebp(b) { return b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP"; }

  function stripJpeg(buf) {
    if (!isJpeg(buf)) return buf;
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    var out = [buf.subarray(0, 2)];
    var i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xFF) { out.push(buf.subarray(i)); break; }
      var m = i + 1;
      while (m < buf.length && buf[m] === 0xFF) m++;
      if (m >= buf.length) { out.push(buf.subarray(i)); break; }
      var marker = buf[m];
      if (marker === 0xDA) { out.push(buf.subarray(i)); break; }          // SOS: scan data follows, keep all
      if (marker === 0xD9) { out.push(buf.subarray(i, m + 1)); break; }   // EOI
      if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {        // RSTn / TEM: no length
        out.push(buf.subarray(i, m + 1)); i = m + 1; continue;
      }
      if (m + 2 >= buf.length) { out.push(buf.subarray(i)); break; }
      var len = dv.getUint16(m + 1);
      var segEnd = m + 1 + len;
      if (segEnd > buf.length) { out.push(buf.subarray(i)); break; }
      var isAppN = marker >= 0xE0 && marker <= 0xEF;
      var isCom = marker === 0xFE;
      if (!isAppN && !isCom) out.push(buf.subarray(i, segEnd));
      i = segEnd;
    }
    return concat(out);
  }

  function stripWebp(buf) {
    if (!isWebp(buf)) return buf;
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    var out = [null];
    var total = 0, i = 12;
    while (i + 8 <= buf.length) {
      var id = ascii(buf, i, i + 4);
      var size = dv.getUint32(i + 4, true);
      var padded = size + (size & 1);
      var end = i + 8 + padded;
      if (end > buf.length) break;
      if (id !== "EXIF" && id !== "XMP ") { var chunk = buf.subarray(i, end); out.push(chunk); total += chunk.length; }
      i = end;
    }
    var head = new Uint8Array(12);
    head.set([0x52, 0x49, 0x46, 0x46], 0);                         // RIFF
    new DataView(head.buffer).setUint32(4, 4 + total, true);
    head.set([0x57, 0x45, 0x42, 0x50], 8);                         // WEBP
    out[0] = head;
    return concat(out);
  }

  var PNG_KEEP = { IHDR: 1, PLTE: 1, IDAT: 1, IEND: 1, tRNS: 1, gAMA: 1, cHRM: 1, sRGB: 1, iCCP: 1, sBIT: 1, bKGD: 1, hIST: 1 };
  function stripPng(buf) {
    if (!isPng(buf)) return buf;
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    var out = [buf.subarray(0, 8)];
    var i = 8;
    while (i + 12 <= buf.length) {
      var len = dv.getUint32(i);
      var type = ascii(buf, i + 4, i + 8);
      var end = i + 8 + len + 4;
      if (end > buf.length) break;
      if (PNG_KEEP[type]) out.push(buf.subarray(i, end));
      i = end;
      if (type === "IEND") break;
    }
    return concat(out);
  }

  function strip(buf, type) {
    if (!buf || !buf.length) return buf;
    if (type === "image/jpeg" || isJpeg(buf)) return stripJpeg(buf);
    if (type === "image/webp" || isWebp(buf)) return stripWebp(buf);
    if (type === "image/png"  || isPng(buf))  return stripPng(buf);
    return buf;
  }

  // The real bytes must match the claimed type. A renamed file is refused, not guessed at.
  function matchesMime(buf, type) {
    if (type === "image/jpeg") return isJpeg(buf);
    if (type === "image/png")  return isPng(buf);
    if (type === "image/webp") return isWebp(buf);
    return false;
  }

  function compress(file) {
    var mobile = window.innerWidth <= 700;
    var big = file.size > 4 * 1024 * 1024;
    var maxSide = mobile || big ? 1200 : 1600;
    var quality = mobile ? 0.72 : (big ? 0.75 : 0.82);
    // WebP is always re-encoded as JPEG: link previews (and the card drawn for them) can't use it.
    var webp = file.type === "image/webp";
    if (file.size < 200 * 1024 && !webp) return Promise.resolve(file);
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
      var c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      var toBlob = c.convertToBlob
        ? c.convertToBlob({ type: "image/jpeg", quality: quality })
        : new Promise(function (r) { c.toBlob(r, "image/jpeg", quality); });
      return toBlob.then(function (blob) { return blob && (webp || blob.size < file.size) ? blob : file; });
    }).catch(function () { return file; });
  }

  // Compress, strip, verify, upload. Resolves to the public URL — or, for the private `proofs`
  // bucket, to the storage path, since a private object has no public address.
  function upload(sb, uid, file, bucket) {
    bucket = bucket || "photos";
    if (!uid) return Promise.reject(new Error("Sign in to add photos."));
    if (!ALLOWED[file.type]) return Promise.reject(new Error("Photos need to be JPEG, PNG or WebP."));
    return compress(file).then(function (blob) {
      var type = blob.type || file.type;
      if (!ALLOWED[type]) type = file.type;
      return blob.arrayBuffer().then(function (ab) {
        var bytes = strip(new Uint8Array(ab), type);
        if (!matchesMime(bytes, type)) throw new Error("That file is not the kind of image it says it is.");
        if (bytes.length > MAX_BYTES) throw new Error("That photo is still over 8 MB after compression.");
        var path = uid + "/" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "." + ALLOWED[type];
        return sb.storage.from(bucket).upload(path, new Blob([bytes], { type: type }), { contentType: type, upsert: false })
          .then(function (r) {
            if (r.error) throw r.error;
            return bucket === "photos" ? sb.storage.from(bucket).getPublicUrl(path).data.publicUrl : path;
          });
      });
    });
  }

  window.DTP_PHOTOS = { upload: upload, strip: strip, matchesMime: matchesMime, MAX_PHOTOS: MAX_PHOTOS,
                        _isJpeg: isJpeg, _isPng: isPng, _isWebp: isWebp };
})();
