// @huh-david/bmp-js 0.8.8 (dist/chunk-YH5DJH4H.js from the npm package), https://github.com/Huh-David/bmp-js
// MIT License, see LICENSE in this folder.

// src/binary.ts
function toUint8Array(input) {
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}
function assertInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

// src/decoder.ts
var FILE_HEADER_SIZE = 14;
var INFO_HEADER_MIN = 40;
var CORE_HEADER_SIZE = 12;
function rowStride(width, bitPP) {
  return Math.floor((bitPP * width + 31) / 32) * 4;
}
var BmpDecoder = class {
  pos = 0;
  bytes;
  view;
  options;
  bottomUp = true;
  dibStart = FILE_HEADER_SIZE;
  paletteEntrySize = 4;
  externalMaskOffset = 0;
  maskRed = 0;
  maskGreen = 0;
  maskBlue = 0;
  maskAlpha = 0;
  fileSize;
  reserved;
  offset;
  headerSize;
  width;
  height;
  planes;
  bitPP;
  compress;
  rawSize;
  hr;
  vr;
  colors;
  importantColors;
  palette;
  data;
  constructor(input, options = {}) {
    this.bytes = toUint8Array(input);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.options = {
      treat16BitAs15BitAlpha: options.treat16BitAs15BitAlpha ?? false,
      toRGBA: options.toRGBA ?? false
    };
    this.parseFileHeader();
    this.parseDibHeader();
    this.parsePalette();
    this.pos = this.offset;
    this.parseRGBA();
    this.transformToRgbaIfNeeded();
  }
  ensureReadable(offset, size, context) {
    if (offset < 0 || size < 0 || offset + size > this.bytes.length) {
      throw new Error(`BMP decode out-of-range while reading ${context}`);
    }
  }
  readUInt8(offset = this.pos) {
    this.ensureReadable(offset, 1, "uint8");
    if (offset === this.pos) this.pos += 1;
    return this.view.getUint8(offset);
  }
  readUInt16LE(offset = this.pos) {
    this.ensureReadable(offset, 2, "uint16");
    if (offset === this.pos) this.pos += 2;
    return this.view.getUint16(offset, true);
  }
  readInt16LE(offset = this.pos) {
    this.ensureReadable(offset, 2, "int16");
    if (offset === this.pos) this.pos += 2;
    return this.view.getInt16(offset, true);
  }
  readUInt32LE(offset = this.pos) {
    this.ensureReadable(offset, 4, "uint32");
    if (offset === this.pos) this.pos += 4;
    return this.view.getUint32(offset, true);
  }
  readInt32LE(offset = this.pos) {
    this.ensureReadable(offset, 4, "int32");
    if (offset === this.pos) this.pos += 4;
    return this.view.getInt32(offset, true);
  }
  parseFileHeader() {
    this.ensureReadable(0, FILE_HEADER_SIZE, "file header");
    if (this.bytes[0] !== 66 || this.bytes[1] !== 77) {
      throw new Error("Invalid BMP file signature");
    }
    this.pos = 2;
    this.fileSize = this.readUInt32LE();
    this.reserved = this.readUInt32LE();
    this.offset = this.readUInt32LE();
    if (this.offset < FILE_HEADER_SIZE || this.offset > this.bytes.length) {
      throw new Error(`Invalid pixel data offset: ${this.offset}`);
    }
  }
  parseDibHeader() {
    this.pos = this.dibStart;
    this.headerSize = this.readUInt32LE();
    if (this.headerSize < CORE_HEADER_SIZE) {
      throw new Error(`Unsupported DIB header size: ${this.headerSize}`);
    }
    this.ensureReadable(this.dibStart, this.headerSize, "DIB header");
    if (this.headerSize === CORE_HEADER_SIZE) {
      this.parseCoreHeader();
      return;
    }
    if (this.headerSize < INFO_HEADER_MIN) {
      throw new Error(`Unsupported DIB header size: ${this.headerSize}`);
    }
    this.parseInfoHeader();
  }
  parseCoreHeader() {
    const width = this.readUInt16LE(this.dibStart + 4);
    const height = this.readUInt16LE(this.dibStart + 6);
    this.width = width;
    this.height = height;
    this.planes = this.readUInt16LE(this.dibStart + 8);
    this.bitPP = this.readUInt16LE(this.dibStart + 10);
    this.compress = 0;
    this.rawSize = 0;
    this.hr = 0;
    this.vr = 0;
    this.colors = 0;
    this.importantColors = 0;
    this.bottomUp = true;
    this.paletteEntrySize = 3;
    this.externalMaskOffset = this.dibStart + this.headerSize;
    this.validateDimensions();
  }
  parseInfoHeader() {
    const rawWidth = this.readInt32LE(this.dibStart + 4);
    const rawHeight = this.readInt32LE(this.dibStart + 8);
    this.width = rawWidth;
    this.height = rawHeight;
    this.planes = this.readUInt16LE(this.dibStart + 12);
    this.bitPP = this.readUInt16LE(this.dibStart + 14);
    this.compress = this.readUInt32LE(this.dibStart + 16);
    this.rawSize = this.readUInt32LE(this.dibStart + 20);
    this.hr = this.readUInt32LE(this.dibStart + 24);
    this.vr = this.readUInt32LE(this.dibStart + 28);
    this.colors = this.readUInt32LE(this.dibStart + 32);
    this.importantColors = this.readUInt32LE(this.dibStart + 36);
    this.paletteEntrySize = 4;
    this.externalMaskOffset = this.dibStart + this.headerSize;
    if (this.height < 0) {
      this.height *= -1;
      this.bottomUp = false;
    }
    if (this.width < 0) {
      this.width *= -1;
    }
    if (this.bitPP === 16 && this.options.treat16BitAs15BitAlpha) {
      this.bitPP = 15;
    }
    this.validateDimensions();
    this.parseBitMasks();
  }
  validateDimensions() {
    if (!Number.isInteger(this.width) || !Number.isInteger(this.height) || this.width <= 0 || this.height <= 0) {
      throw new Error(`Invalid BMP dimensions: ${this.width}x${this.height}`);
    }
  }
  parseBitMasks() {
    if (!(this.bitPP === 16 || this.bitPP === 32) || !(this.compress === 3 || this.compress === 6)) {
      return;
    }
    const inHeaderMaskStart = this.dibStart + 40;
    const hasMasksInHeader = this.headerSize >= 52;
    const maskStart = hasMasksInHeader ? inHeaderMaskStart : this.externalMaskOffset;
    const maskCount = this.compress === 6 || this.headerSize >= 56 ? 4 : 3;
    this.ensureReadable(maskStart, maskCount * 4, "bit masks");
    this.maskRed = this.readUInt32LE(maskStart);
    this.maskGreen = this.readUInt32LE(maskStart + 4);
    this.maskBlue = this.readUInt32LE(maskStart + 8);
    this.maskAlpha = maskCount >= 4 ? this.readUInt32LE(maskStart + 12) : 0;
    if (!hasMasksInHeader) {
      this.externalMaskOffset += maskCount * 4;
    }
  }
  parsePalette() {
    if (this.bitPP >= 16) {
      return;
    }
    const colorCount = this.colors === 0 ? 1 << this.bitPP : this.colors;
    if (colorCount <= 0) {
      return;
    }
    const paletteStart = this.externalMaskOffset;
    const paletteSize = colorCount * this.paletteEntrySize;
    if (paletteStart + paletteSize > this.offset) {
      throw new Error("Palette data overlaps or exceeds pixel data offset");
    }
    this.palette = new Array(colorCount);
    for (let i = 0; i < colorCount; i += 1) {
      const base = paletteStart + i * this.paletteEntrySize;
      const blue = this.readUInt8(base);
      const green = this.readUInt8(base + 1);
      const red = this.readUInt8(base + 2);
      const quad = this.paletteEntrySize === 4 ? this.readUInt8(base + 3) : 0;
      this.palette[i] = { red, green, blue, quad };
    }
  }
  parseRGBA() {
    const pixelCount = this.width * this.height;
    const len = pixelCount * 4;
    this.data = new Uint8Array(len);
    switch (this.bitPP) {
      case 1:
        this.bit1();
        return;
      case 4:
        this.bit4();
        return;
      case 8:
        this.bit8();
        return;
      case 15:
        this.bit15();
        return;
      case 16:
        this.bit16();
        return;
      case 24:
        this.bit24();
        return;
      case 32:
        this.bit32();
        return;
      default:
        throw new Error(`Unsupported BMP bit depth: ${this.bitPP}`);
    }
  }
  transformToRgbaIfNeeded() {
    if (!this.options.toRGBA) {
      return;
    }
    for (let i = 0; i < this.data.length; i += 4) {
      const alpha = this.data[i] ?? 0;
      const blue = this.data[i + 1] ?? 0;
      const green = this.data[i + 2] ?? 0;
      const red = this.data[i + 3] ?? 0;
      this.data[i] = red;
      this.data[i + 1] = green;
      this.data[i + 2] = blue;
      this.data[i + 3] = alpha;
    }
  }
  getPaletteColor(index) {
    const color = this.palette?.[index];
    if (color) {
      return color;
    }
    return { red: 255, green: 255, blue: 255, quad: 0 };
  }
  setPixel(destY, x, alpha, blue, green, red) {
    const base = (destY * this.width + x) * 4;
    this.data[base] = alpha;
    this.data[base + 1] = blue;
    this.data[base + 2] = green;
    this.data[base + 3] = red;
  }
  bit1() {
    const stride = rowStride(this.width, 1);
    const bytesPerRow = Math.ceil(this.width / 8);
    for (let srcRow = 0; srcRow < this.height; srcRow += 1) {
      const rowStart = this.offset + srcRow * stride;
      this.ensureReadable(rowStart, bytesPerRow, "1-bit row");
      const destY = this.bottomUp ? this.height - 1 - srcRow : srcRow;
      for (let x = 0; x < this.width; x += 1) {
        const packed = this.readUInt8(rowStart + Math.floor(x / 8));
        const bit = packed >> 7 - x % 8 & 1;
        const rgb = this.getPaletteColor(bit);
        this.setPixel(destY, x, 255, rgb.blue, rgb.green, rgb.red);
      }
    }
  }
  bit4() {
    if (this.compress === 2) {
      this.bit4Rle();
      return;
    }
    const stride = rowStride(this.width, 4);
    const bytesPerRow = Math.ceil(this.width / 2);
    for (let srcRow = 0; srcRow < this.height; srcRow += 1) {
      const rowStart = this.offset + srcRow * stride;
      this.ensureReadable(rowStart, bytesPerRow, "4-bit row");
      const destY = this.bottomUp ? this.height - 1 - srcRow : srcRow;
      for (let x = 0; x < this.width; x += 1) {
        const packed = this.readUInt8(rowStart + Math.floor(x / 2));
        const idx = x % 2 === 0 ? (packed & 240) >> 4 : packed & 15;
        const rgb = this.getPaletteColor(idx);
        this.setPixel(destY, x, 255, rgb.blue, rgb.green, rgb.red);
      }
    }
  }
  bit8() {
    if (this.compress === 1) {
      this.bit8Rle();
      return;
    }
    const stride = rowStride(this.width, 8);
    const bytesPerRow = this.width;
    for (let srcRow = 0; srcRow < this.height; srcRow += 1) {
      const rowStart = this.offset + srcRow * stride;
      this.ensureReadable(rowStart, bytesPerRow, "8-bit row");
      const destY = this.bottomUp ? this.height - 1 - srcRow : srcRow;
      for (let x = 0; x < this.width; x += 1) {
        const idx = this.readUInt8(rowStart + x);
        const rgb = this.getPaletteColor(idx);
        this.setPixel(destY, x, 255, rgb.blue, rgb.green, rgb.red);
      }
    }
  }
  bit15() {
    const stride = rowStride(this.width, 16);
    const max = 31;
    for (let srcRow = 0; srcRow < this.height; srcRow += 1) {
      const rowStart = this.offset + srcRow * stride;
      this.ensureReadable(rowStart, this.width * 2, "15-bit row");
      const destY = this.bottomUp ? this.height - 1 - srcRow : srcRow;
      for (let x = 0; x < this.width; x += 1) {
        const value = this.readUInt16LE(rowStart + x * 2);
        const blue = (value >> 0 & max) / max * 255;
        const green = (value >> 5 & max) / max * 255;
        const red = (value >> 10 & max) / max * 255;
        const alpha = (value & 32768) !== 0 ? 255 : 0;
        this.setPixel(destY, x, alpha, blue | 0, green | 0, red | 0);
      }
    }
  }
  scaleMasked(value, mask) {
    if (mask === 0) return 0;
    let shift = 0;
    let bits = 0;
    let m = mask;
    while ((m & 1) === 0) {
      shift += 1;
      m >>>= 1;
    }
    while ((m & 1) === 1) {
      bits += 1;
      m >>>= 1;
    }
    const component = (value & mask) >>> shift;
    if (bits >= 8) {
      return component >>> bits - 8;
    }
    return component << 8 - bits & 255;
  }
  bit16() {
    if (this.maskRed === 0 && this.maskGreen === 0 && this.maskBlue === 0) {
      this.maskRed = 31744;
      this.maskGreen = 992;
      this.maskBlue = 31;
    }
    const stride = rowStride(this.width, 16);
    for (let srcRow = 0; srcRow < this.height; srcRow += 1) {
      const rowStart = this.offset + srcRow * stride;
      this.ensureReadable(rowStart, this.width * 2, "16-bit row");
      const destY = this.bottomUp ? this.height - 1 - srcRow : srcRow;
      for (let x = 0; x < this.width; x += 1) {
        const value = this.readUInt16LE(rowStart + x * 2);
        const blue = this.scaleMasked(value, this.maskBlue);
        const green = this.scaleMasked(value, this.maskGreen);
        const red = this.scaleMasked(value, this.maskRed);
        const alpha = this.maskAlpha !== 0 ? this.scaleMasked(value, this.maskAlpha) : 255;
        this.setPixel(destY, x, alpha, blue, green, red);
      }
    }
  }
  bit24() {
    const stride = rowStride(this.width, 24);
    for (let srcRow = 0; srcRow < this.height; srcRow += 1) {
      const rowStart = this.offset + srcRow * stride;
      this.ensureReadable(rowStart, this.width * 3, "24-bit row");
      const destY = this.bottomUp ? this.height - 1 - srcRow : srcRow;
      for (let x = 0; x < this.width; x += 1) {
        const base = rowStart + x * 3;
        const blue = this.readUInt8(base);
        const green = this.readUInt8(base + 1);
        const red = this.readUInt8(base + 2);
        this.setPixel(destY, x, 255, blue, green, red);
      }
    }
  }
  bit32() {
    const stride = rowStride(this.width, 32);
    for (let srcRow = 0; srcRow < this.height; srcRow += 1) {
      const rowStart = this.offset + srcRow * stride;
      this.ensureReadable(rowStart, this.width * 4, "32-bit row");
      const destY = this.bottomUp ? this.height - 1 - srcRow : srcRow;
      for (let x = 0; x < this.width; x += 1) {
        const base = rowStart + x * 4;
        if (this.compress === 3 || this.compress === 6) {
          const pixel = this.readUInt32LE(base);
          const red = this.scaleMasked(pixel, this.maskRed || 16711680);
          const green = this.scaleMasked(pixel, this.maskGreen || 65280);
          const blue = this.scaleMasked(pixel, this.maskBlue || 255);
          const alpha = this.maskAlpha === 0 ? 255 : this.scaleMasked(pixel, this.maskAlpha);
          this.setPixel(destY, x, alpha, blue, green, red);
        } else {
          const blue = this.readUInt8(base);
          const green = this.readUInt8(base + 1);
          const red = this.readUInt8(base + 2);
          const alpha = this.readUInt8(base + 3);
          this.setPixel(destY, x, alpha, blue, green, red);
        }
      }
    }
  }
  bit8Rle() {
    this.data.fill(255);
    this.pos = this.offset;
    let x = 0;
    let y = this.bottomUp ? this.height - 1 : 0;
    while (this.pos < this.bytes.length) {
      const count = this.readUInt8();
      const value = this.readUInt8();
      if (count === 0) {
        if (value === 0) {
          x = 0;
          y += this.bottomUp ? -1 : 1;
          continue;
        }
        if (value === 1) {
          break;
        }
        if (value === 2) {
          x += this.readUInt8();
          y += this.bottomUp ? -this.readUInt8() : this.readUInt8();
          continue;
        }
        for (let i = 0; i < value; i += 1) {
          const idx = this.readUInt8();
          const rgb2 = this.getPaletteColor(idx);
          if (x < this.width && y >= 0 && y < this.height) {
            this.setPixel(y, x, 255, rgb2.blue, rgb2.green, rgb2.red);
          }
          x += 1;
        }
        if ((value & 1) === 1) {
          this.pos += 1;
        }
        continue;
      }
      const rgb = this.getPaletteColor(value);
      for (let i = 0; i < count; i += 1) {
        if (x < this.width && y >= 0 && y < this.height) {
          this.setPixel(y, x, 255, rgb.blue, rgb.green, rgb.red);
        }
        x += 1;
      }
    }
  }
  bit4Rle() {
    this.data.fill(255);
    this.pos = this.offset;
    let x = 0;
    let y = this.bottomUp ? this.height - 1 : 0;
    while (this.pos < this.bytes.length) {
      const count = this.readUInt8();
      const value = this.readUInt8();
      if (count === 0) {
        if (value === 0) {
          x = 0;
          y += this.bottomUp ? -1 : 1;
          continue;
        }
        if (value === 1) {
          break;
        }
        if (value === 2) {
          x += this.readUInt8();
          y += this.bottomUp ? -this.readUInt8() : this.readUInt8();
          continue;
        }
        let current = this.readUInt8();
        for (let i = 0; i < value; i += 1) {
          const nibble = i % 2 === 0 ? (current & 240) >> 4 : current & 15;
          const rgb = this.getPaletteColor(nibble);
          if (x < this.width && y >= 0 && y < this.height) {
            this.setPixel(y, x, 255, rgb.blue, rgb.green, rgb.red);
          }
          x += 1;
          if (i % 2 === 1 && i + 1 < value) {
            current = this.readUInt8();
          }
        }
        if ((value + 1 >> 1 & 1) === 1) {
          this.pos += 1;
        }
        continue;
      }
      for (let i = 0; i < count; i += 1) {
        const nibble = i % 2 === 0 ? (value & 240) >> 4 : value & 15;
        const rgb = this.getPaletteColor(nibble);
        if (x < this.width && y >= 0 && y < this.height) {
          this.setPixel(y, x, 255, rgb.blue, rgb.green, rgb.red);
        }
        x += 1;
      }
    }
  }
  getData() {
    return this.data;
  }
};
function decode(bmpData, options) {
  return new BmpDecoder(bmpData, options);
}

// src/encoder.ts
var FILE_HEADER_SIZE2 = 14;
var INFO_HEADER_SIZE = 40;
var BYTES_PER_PIXEL_ABGR = 4;
var SUPPORTED_BIT_DEPTHS = [1, 4, 8, 16, 24, 32];
function isSupportedBitDepth(value) {
  return SUPPORTED_BIT_DEPTHS.includes(value);
}
function normalizeEncodeOptions(qualityOrOptions) {
  if (typeof qualityOrOptions === "number" || typeof qualityOrOptions === "undefined") {
    return {
      orientation: "top-down",
      bitPP: 24,
      palette: []
    };
  }
  return {
    orientation: qualityOrOptions.orientation ?? "top-down",
    bitPP: qualityOrOptions.bitPP ?? 24,
    palette: qualityOrOptions.palette ?? []
  };
}
var BmpEncoder = class {
  pixelData;
  width;
  height;
  options;
  palette;
  exactPaletteIndex = /* @__PURE__ */ new Map();
  constructor(imgData, options) {
    this.pixelData = imgData.data;
    this.width = imgData.width;
    this.height = imgData.height;
    this.options = options;
    this.palette = this.normalizePalette(options);
    assertInteger("width", this.width);
    assertInteger("height", this.height);
    if (!isSupportedBitDepth(this.options.bitPP)) {
      throw new Error(
        `Unsupported encode bit depth: ${this.options.bitPP}. Supported: 1, 4, 8, 16, 24, 32.`
      );
    }
    const minLength = this.width * this.height * BYTES_PER_PIXEL_ABGR;
    if (this.pixelData.length < minLength) {
      throw new Error(
        `Image data is too short: expected at least ${minLength} bytes for ${this.width}x${this.height} ABGR data.`
      );
    }
    for (let i = 0; i < this.palette.length; i += 1) {
      const color = this.palette[i];
      const key = this.paletteKey(color.quad, color.blue, color.green, color.red);
      if (!this.exactPaletteIndex.has(key)) {
        this.exactPaletteIndex.set(key, i);
      }
    }
  }
  normalizePalette(options) {
    if (options.bitPP === 1) {
      const palette = options.palette.length ? options.palette : [
        { red: 255, green: 255, blue: 255, quad: 0 },
        { red: 0, green: 0, blue: 0, quad: 0 }
      ];
      this.validatePalette(options.bitPP, palette);
      return palette;
    }
    if (options.bitPP === 4 || options.bitPP === 8) {
      if (options.palette.length === 0) {
        throw new Error(`Encoding ${options.bitPP}-bit BMP requires a non-empty palette.`);
      }
      this.validatePalette(options.bitPP, options.palette);
      return options.palette;
    }
    return [];
  }
  validatePalette(bitPP, palette) {
    const maxSize = 1 << bitPP;
    if (palette.length === 0 || palette.length > maxSize) {
      throw new Error(
        `Palette size ${palette.length} is invalid for ${bitPP}-bit BMP. Expected 1..${maxSize}.`
      );
    }
    for (const color of palette) {
      this.validateChannel("palette.red", color.red);
      this.validateChannel("palette.green", color.green);
      this.validateChannel("palette.blue", color.blue);
      this.validateChannel("palette.quad", color.quad);
    }
  }
  validateChannel(name, value) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`${name} must be an integer between 0 and 255.`);
    }
  }
  rowStride() {
    return Math.floor((this.options.bitPP * this.width + 31) / 32) * 4;
  }
  sourceY(fileRow) {
    return this.options.orientation === "top-down" ? fileRow : this.height - 1 - fileRow;
  }
  sourceOffset(x, y) {
    return (y * this.width + x) * BYTES_PER_PIXEL_ABGR;
  }
  paletteKey(alpha, blue, green, red) {
    return ((alpha & 255) << 24 | (blue & 255) << 16 | (green & 255) << 8 | red & 255) >>> 0;
  }
  findPaletteIndex(a, b, g, r) {
    const exact = this.exactPaletteIndex.get(this.paletteKey(a, b, g, r));
    if (exact !== void 0) {
      return exact;
    }
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.palette.length; i += 1) {
      const color = this.palette[i];
      const dr = color.red - r;
      const dg = color.green - g;
      const db = color.blue - b;
      const da = color.quad - a;
      const distance = dr * dr + dg * dg + db * db + da * da;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }
  writePalette(output, paletteOffset) {
    for (let i = 0; i < this.palette.length; i += 1) {
      const color = this.palette[i];
      const base = paletteOffset + i * 4;
      output[base] = color.blue;
      output[base + 1] = color.green;
      output[base + 2] = color.red;
      output[base + 3] = color.quad;
    }
  }
  encode1Bit(output, pixelOffset, stride) {
    for (let fileRow = 0; fileRow < this.height; fileRow += 1) {
      const srcY = this.sourceY(fileRow);
      const rowStart = pixelOffset + fileRow * stride;
      for (let x = 0; x < this.width; x += 8) {
        let packed = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const px = x + bit;
          if (px >= this.width) {
            break;
          }
          const source = this.sourceOffset(px, srcY);
          const a = this.pixelData[source] ?? 255;
          const b = this.pixelData[source + 1] ?? 0;
          const g = this.pixelData[source + 2] ?? 0;
          const r = this.pixelData[source + 3] ?? 0;
          const idx = this.findPaletteIndex(a, b, g, r) & 1;
          packed |= idx << 7 - bit;
        }
        output[rowStart + Math.floor(x / 8)] = packed;
      }
    }
  }
  encode4Bit(output, pixelOffset, stride) {
    for (let fileRow = 0; fileRow < this.height; fileRow += 1) {
      const srcY = this.sourceY(fileRow);
      const rowStart = pixelOffset + fileRow * stride;
      for (let x = 0; x < this.width; x += 2) {
        const sourceA = this.sourceOffset(x, srcY);
        const idxA = this.findPaletteIndex(
          this.pixelData[sourceA] ?? 255,
          this.pixelData[sourceA + 1] ?? 0,
          this.pixelData[sourceA + 2] ?? 0,
          this.pixelData[sourceA + 3] ?? 0
        );
        let idxB = 0;
        if (x + 1 < this.width) {
          const sourceB = this.sourceOffset(x + 1, srcY);
          idxB = this.findPaletteIndex(
            this.pixelData[sourceB] ?? 255,
            this.pixelData[sourceB + 1] ?? 0,
            this.pixelData[sourceB + 2] ?? 0,
            this.pixelData[sourceB + 3] ?? 0
          );
        }
        output[rowStart + Math.floor(x / 2)] = (idxA & 15) << 4 | idxB & 15;
      }
    }
  }
  encode8Bit(output, pixelOffset, stride) {
    for (let fileRow = 0; fileRow < this.height; fileRow += 1) {
      const srcY = this.sourceY(fileRow);
      const rowStart = pixelOffset + fileRow * stride;
      for (let x = 0; x < this.width; x += 1) {
        const source = this.sourceOffset(x, srcY);
        output[rowStart + x] = this.findPaletteIndex(
          this.pixelData[source] ?? 255,
          this.pixelData[source + 1] ?? 0,
          this.pixelData[source + 2] ?? 0,
          this.pixelData[source + 3] ?? 0
        );
      }
    }
  }
  encode16Bit(output, view, pixelOffset, stride) {
    for (let fileRow = 0; fileRow < this.height; fileRow += 1) {
      const srcY = this.sourceY(fileRow);
      const rowStart = pixelOffset + fileRow * stride;
      for (let x = 0; x < this.width; x += 1) {
        const source = this.sourceOffset(x, srcY);
        const b = this.pixelData[source + 1] ?? 0;
        const g = this.pixelData[source + 2] ?? 0;
        const r = this.pixelData[source + 3] ?? 0;
        const value = (r >> 3 & 31) << 10 | (g >> 3 & 31) << 5 | b >> 3 & 31;
        view.setUint16(rowStart + x * 2, value, true);
      }
    }
  }
  encode24Bit(output, pixelOffset, stride) {
    for (let fileRow = 0; fileRow < this.height; fileRow += 1) {
      const srcY = this.sourceY(fileRow);
      const rowStart = pixelOffset + fileRow * stride;
      for (let x = 0; x < this.width; x += 1) {
        const source = this.sourceOffset(x, srcY);
        const target = rowStart + x * 3;
        output[target] = this.pixelData[source + 1] ?? 0;
        output[target + 1] = this.pixelData[source + 2] ?? 0;
        output[target + 2] = this.pixelData[source + 3] ?? 0;
      }
    }
  }
  encode32Bit(output, pixelOffset, stride) {
    for (let fileRow = 0; fileRow < this.height; fileRow += 1) {
      const srcY = this.sourceY(fileRow);
      const rowStart = pixelOffset + fileRow * stride;
      for (let x = 0; x < this.width; x += 1) {
        const source = this.sourceOffset(x, srcY);
        const target = rowStart + x * 4;
        output[target] = this.pixelData[source + 1] ?? 0;
        output[target + 1] = this.pixelData[source + 2] ?? 0;
        output[target + 2] = this.pixelData[source + 3] ?? 0;
        output[target + 3] = this.pixelData[source] ?? 255;
      }
    }
  }
  encode() {
    const stride = this.rowStride();
    const imageSize = stride * this.height;
    const paletteSize = this.palette.length * 4;
    const offset = FILE_HEADER_SIZE2 + INFO_HEADER_SIZE + paletteSize;
    const totalSize = offset + imageSize;
    const output = new Uint8Array(totalSize);
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
    output[0] = 66;
    output[1] = 77;
    view.setUint32(2, totalSize, true);
    view.setUint32(6, 0, true);
    view.setUint32(10, offset, true);
    view.setUint32(14, INFO_HEADER_SIZE, true);
    view.setInt32(18, this.width, true);
    const signedHeight = this.options.orientation === "top-down" ? -this.height : this.height;
    view.setInt32(22, signedHeight, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, this.options.bitPP, true);
    view.setUint32(30, 0, true);
    view.setUint32(34, imageSize, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, 0, true);
    view.setUint32(46, this.palette.length, true);
    view.setUint32(50, 0, true);
    if (this.palette.length > 0) {
      this.writePalette(output, FILE_HEADER_SIZE2 + INFO_HEADER_SIZE);
    }
    switch (this.options.bitPP) {
      case 1:
        this.encode1Bit(output, offset, stride);
        break;
      case 4:
        this.encode4Bit(output, offset, stride);
        break;
      case 8:
        this.encode8Bit(output, offset, stride);
        break;
      case 16:
        this.encode16Bit(output, view, offset, stride);
        break;
      case 24:
        this.encode24Bit(output, offset, stride);
        break;
      case 32:
        this.encode32Bit(output, offset, stride);
        break;
    }
    return output;
  }
};
function encode(imgData, qualityOrOptions) {
  const options = normalizeEncodeOptions(qualityOrOptions);
  const encoder = new BmpEncoder(imgData, options);
  const data = encoder.encode();
  return {
    data,
    width: imgData.width,
    height: imgData.height
  };
}

export {
  BmpDecoder,
  decode,
  BmpEncoder,
  encode
};
