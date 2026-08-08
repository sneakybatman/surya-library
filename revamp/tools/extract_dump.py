#!/usr/bin/env python3
"""Extract ACC_REG rows from a classic Oracle exp dump (no Oracle needed).

Dump layout (reverse-engineered, verified against DataBackup130722.dmp):
  ... DDL text ... INSERT INTO "ACC_REG" (...) VALUES (...)\n
  uint16 ncols
  per column: uint16 type, uint16 maxlen [, uint16 charset, uint16 flag  for char types]
  then rows, each: uint16 0x0000 marker, then per column: uint16 len (0xFFFE = NULL) + bytes
  table data ends at a 0xFFFF marker.
Types seen: 1=VARCHAR2 (UTF-8, charset id 873), 2=NUMBER, 12=DATE.
"""
import csv
import json
import re
import struct
import sys
from collections import Counter
from decimal import Decimal
from pathlib import Path

DUMP = Path(sys.argv[1] if len(sys.argv) > 1 else
            "/Users/anshuman/code/LibrarySuryaFoundation/Data/DataBackup130722.dmp")
OUT_DIR = Path(__file__).resolve().parent.parent / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def decode_number(b: bytes):
    if b == b"\x80":
        return Decimal(0)
    b0 = b[0]
    if b0 & 0x80:
        exp = (b0 & 0x7F) - 65
        digits = [x - 1 for x in b[1:]]
        sign = 1
    else:
        exp = ((~b0) & 0x7F) - 65
        digits = [101 - x for x in b[1:] if x != 102]
        sign = -1
    val = Decimal(0)
    for idx, d in enumerate(digits):
        val += Decimal(d) * (Decimal(100) ** (exp - idx))
    return sign * val


def decode_date(b: bytes):
    year = (b[0] - 100) * 100 + (b[1] - 100)
    return f"{year:04d}-{b[2]:02d}-{b[3]:02d}"


def fmt(v):
    if v is None:
        return ""
    if isinstance(v, Decimal):
        return str(v.quantize(Decimal(1)) if v == v.to_integral_value() else v.normalize())
    return v


data = DUMP.read_bytes()

m = re.search(rb'INSERT INTO "ACC_REG" \((.*?)\) VALUES', data, re.S)
colnames = [c.strip().strip('"') for c in m.group(1).decode().split(",")]
p = data.find(b")", data.find(b"VALUES", m.start())) + 2  # past ')' and '\n'

(ncols,) = struct.unpack_from("<H", data, p)
p += 2
assert ncols == len(colnames), (ncols, len(colnames))
coltypes = []
for _ in range(ncols):
    t, maxlen = struct.unpack_from("<HH", data, p)
    p += 4
    if t in (1, 96):
        p += 4  # charset id + flag
    coltypes.append((t, maxlen))

p += 2  # extra 0x0000 before the first row marker
rows = []
truncated = False
while True:
    if p + 4 > len(data):
        truncated = True
        break
    (marker,) = struct.unpack_from("<H", data, p)
    p += 2
    if marker == 0xFFFF:
        break
    assert marker == 0x0000, f"unexpected marker {marker:#x} at {p-2}"
    (peek,) = struct.unpack_from("<H", data, p)
    if peek == 0xFFFF:  # trailing 00 00 FF FF ends the data section
        p += 2
        break
    row = []
    try:
        for t, maxlen in coltypes:
            (ln,) = struct.unpack_from("<H", data, p)
            p += 2
            if ln == 0xFFFE:
                row.append(None)
                continue
            assert ln <= max(maxlen * 4, 22), (ln, maxlen, p)
            raw = data[p : p + ln]
            p += ln
            if t == 1:
                row.append(raw.decode("utf-8", errors="replace").strip() or None)
            elif t == 2:
                row.append(decode_number(raw))
            elif t == 12:
                row.append(decode_date(raw))
            else:
                row.append(raw.hex())
    except struct.error:  # file truncated mid-row: keep complete rows only
        truncated = True
        break
    rows.append(row)
if truncated:
    print("WARNING: dump is truncated (no end marker); "
          "partial final row discarded")

print(f"extracted {len(rows)} rows x {ncols} cols; "
      f"data section ends at offset {p} of {len(data)}")
print("next bytes after end marker:", data[p : p + 60])

csv_path = OUT_DIR / f"{DUMP.stem}_acc_reg.csv"
with csv_path.open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(colnames)
    for row in rows:
        w.writerow([fmt(v) for v in row])
print("wrote", csv_path)

profile = {}
for idx, name in enumerate(colnames):
    vals = [fmt(r[idx]) for r in rows if r[idx] is not None]
    top = Counter(vals).most_common(6)
    profile[name] = {
        "filled": len(vals),
        "fill_pct": round(100 * len(vals) / len(rows), 1),
        "distinct": len(set(vals)),
        "top": top,
    }
profile_path = OUT_DIR / f"{DUMP.stem}_profile.json"
profile_path.write_text(json.dumps({"row_count": len(rows), "columns": profile},
                                   indent=2, ensure_ascii=False))
print("wrote", profile_path)

print(f"\n{'column':<18}{'fill%':>7}  {'distinct':>8}  top values")
for name, st in profile.items():
    tops = ", ".join(f"{v!r}x{c}" for v, c in st["top"][:3])
    print(f"{name:<18}{st['fill_pct']:>6}%  {st['distinct']:>8}  {tops[:90]}")
