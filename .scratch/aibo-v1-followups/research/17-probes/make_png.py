"""Writes the probe image (task 17): a red circle on the left and a blue
square on the right, on white, 200x100. No dependencies.

usage: python3 -I make_png.py OUT.png
"""
import struct, sys, zlib

W, H = 200, 100
rows = []
for y in range(H):
    row = bytearray([0])
    for x in range(W):
        c = (255, 255, 255)
        if (x - 50) ** 2 + (y - 50) ** 2 <= 35 ** 2: c = (220, 20, 20)
        if 120 <= x <= 180 and 20 <= y <= 80: c = (20, 40, 220)
        row += bytes(c)
    rows.append(bytes(row))
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
