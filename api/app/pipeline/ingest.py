"""Layer 01 — ingestion. Files as the client already keeps them.

Deliberately dumb. This module opens a workbook, inventories it, and hands
back a grid plus a Source record. It does not try to understand the sheet;
that is layer 02's job and layer 02 is not built yet.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

from openpyxl import load_workbook

from ..schema import Source


@dataclass
class Sheet:
    name: str
    grid: list[list]  # row-major, 1-indexed rows map to grid[r-1]

    def cell(self, row: int, col: int):
        """1-indexed, spreadsheet convention. Returns None out of range."""
        try:
            return self.grid[row - 1][col - 1]
        except IndexError:
            return None

    def col_values(self, col: int, r0: int, r1: int) -> list:
        return [self.cell(r, col) for r in range(r0, r1 + 1)]

    @property
    def rows(self) -> int:
        return len(self.grid)


@dataclass
class Workbook:
    path: Path
    sheets: dict[str, Sheet]
    source: Source
    warnings: list[dict] = field(default_factory=list)

    def __getitem__(self, name: str) -> Sheet:
        return self.sheets[name]


def a1(row: int, col: int) -> str:
    """(4, 3) -> 'C4'. Cheap, and it keeps provenance strings honest."""
    s = ""
    while col:
        col, rem = divmod(col - 1, 26)
        s = chr(65 + rem) + s
    return f"{s}{row}"


def a1_range(r0: int, c0: int, r1: int, c1: int) -> str:
    return f"{a1(r0, c0)}:{a1(r1, c1)}" if (r0, c0) != (r1, c1) else a1(r0, c0)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _normalise_cell(value):
    import math, re
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return None
    numeric = re.sub(r"[\s\u00a0\u202f]", "", text)
    numeric = re.sub(r"^(?:USD|CDF|EUR|GBP|\$|€|£)", "", numeric, flags=re.I)
    numeric = re.sub(r"(?:USD|CDF|EUR|GBP|\$|€|£)$", "", numeric, flags=re.I)
    if re.fullmatch(r"[-+]?0\d+", numeric):
        return text  # Preserve identifiers such as 00123.
    if re.fullmatch(r"[-+]?\d+(?:[.,]\d+)*", numeric):
        if ',' in numeric and '.' in numeric:
            numeric = numeric.replace('.', '').replace(',', '.') if numeric.rfind(',') > numeric.rfind('.') else numeric.replace(',', '')
        elif ',' in numeric:
            # Three trailing digits are ambiguous: preserve the source text
            # for mapping review instead of guessing decimal/thousands.
            if len(numeric.rsplit(',', 1)[1]) == 3:
                return text
            numeric = numeric.replace(',', '.')
        try:
            parsed = float(numeric)
            if math.isfinite(parsed): return parsed
        except ValueError:
            pass
    return text


def read_workbook(path: str | Path, idx: int = 0) -> Workbook:
    """Read source values and retain explicit formula/cache review findings."""
    import csv, io, zipfile
    from xml.etree.ElementTree import iterparse
    path = Path(path)
    sheets, warnings = {}, []
    if path.suffix.lower() in ('.csv', '.tsv'):
        text = path.read_text(encoding='utf-8-sig')
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=',;\t|')
        grid = [[_normalise_cell(v) for v in row] for row in csv.reader(io.StringIO(text), dialect)]
        sheets['Data'] = Sheet('Data', grid)
    else:
        with zipfile.ZipFile(path) as archive:
            if sum(info.file_size for info in archive.infolist()) > 160 * 1024 * 1024:
                raise ValueError('Workbook expands beyond the supported size.')
        book = load_workbook(path, data_only=True, read_only=True)
        try:
            for ws in book.worksheets:
                if ws.max_row * ws.max_column > 10_000_000:
                    raise ValueError('Worksheet dimensions exceed the supported size.')
                grid = [[_normalise_cell(v) for v in row] for row in ws.iter_rows(values_only=True)]
                while grid and not any(v is not None for v in grid[-1]): grid.pop()
                sheets[ws.title] = Sheet(ws.title, grid)
                with zipfile.ZipFile(path) as archive:
                    with archive.open(ws._worksheet_path) as stream:
                        for _, cell in iterparse(stream, events=('end',)):
                            if cell.tag.rsplit('}', 1)[-1] != 'c': continue
                            children = {el.tag.rsplit('}',1)[-1]: el for el in cell}
                            cached = children.get('v')
                            if cell.get('t') == 'e':
                                warnings.append({'sheet': ws.title, 'cells': cell.get('r'), 'detail': 'Spreadsheet formula error: ' + (cached.text if cached is not None and cached.text else 'unknown')})
                            elif 'f' in children and (cached is None or cached.text is None):
                                warnings.append({'sheet': ws.title, 'cells': cell.get('r'), 'detail': 'Formula has no cached result. Recalculate and save in your spreadsheet application.'})
                            cell.clear()
        finally:
            book.close()
    return Workbook(path=path, sheets=sheets, warnings=warnings,
                    source=Source(idx=idx, filename=path.name, sha256=sha256(path), sheets=len(sheets), rows_read=sum(s.rows for s in sheets.values())))
