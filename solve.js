const KEEP = 0;
const DELETE = 1;
const INSERT = 2;
const INVALID = -1000000000;

function splitLines(text) {
  const lines = [];
  let start = 0;
  let index = text.indexOf('\n', start);
  while (index !== -1) {
    lines.push(text.slice(start, index + 1));
    start = index + 1;
    index = text.indexOf('\n', start);
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function encodeLines(oldLines, newLines) {
  const ids = new Map();
  const oldIds = new Int32Array(oldLines.length);
  const newIds = new Int32Array(newLines.length);
  for (let i = 0; i < oldLines.length; i++) {
    const line = oldLines[i];
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    oldIds[i] = id;
  }
  for (let i = 0; i < newLines.length; i++) {
    const line = newLines[i];
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    newIds[i] = id;
  }
  return [oldIds, newIds];
}

function middleOps(oldIds, newIds, oldStart, newStart, oldCount, newCount) {
  if (oldCount === 0) {
    const ops = new Uint8Array(newCount);
    ops.fill(INSERT);
    return ops;
  }
  if (newCount === 0) {
    const ops = new Uint8Array(oldCount);
    ops.fill(DELETE);
    return ops;
  }

  const max = oldCount + newCount;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  v.fill(INVALID);
  v[offset + 1] = 0;
  const trace = [];
  let distance = -1;

  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d) {
        x = v[offset + k + 1];
        if (x - k > newCount) x = INVALID;
      } else if (k === d) {
        x = v[offset + k - 1] + 1;
        if (x > oldCount) x = INVALID;
      } else {
        const downX = v[offset + k + 1];
        const rightX = v[offset + k - 1] + 1;
        const downY = downX - k;
        const rightY = rightX - k;
        const downValid = downX >= 0 && downX <= oldCount && downY >= 0 && downY <= newCount;
        const rightValid = rightX >= 0 && rightX <= oldCount && rightY >= 0 && rightY <= newCount;
        if (downValid && rightValid) x = downX > rightX ? downX : rightX;
        else if (downValid) x = downX;
        else if (rightValid) x = rightX;
        else x = INVALID;
      }

      if (x !== INVALID) {
        let y = x - k;
        while (x < oldCount && y < newCount && oldIds[oldStart + x] === newIds[newStart + y]) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= oldCount && y >= newCount) {
          distance = d;
          break;
        }
      } else {
        v[offset + k] = INVALID;
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
    if (distance !== -1) break;
  }

  const reversed = [];
  let x = oldCount;
  let y = newCount;
  for (let d = distance; d > 0; d--) {
    const previous = trace[d - 1];
    const previousOffset = d - 1;
    const k = x - y;
    let previousK;
    let inserted;
    if (k === -d) {
      previousK = k + 1;
      inserted = true;
    } else if (k === d) {
      previousK = k - 1;
      inserted = false;
    } else {
      const downX = previous[k + 1 + previousOffset];
      const rightX = previous[k - 1 + previousOffset] + 1;
      inserted = downX > rightX;
      previousK = inserted ? k + 1 : k - 1;
    }
    const previousX = previous[previousK + previousOffset];
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      reversed.push(KEEP);
      x--;
      y--;
    }
    if (inserted) {
      reversed.push(INSERT);
      y--;
    } else {
      reversed.push(DELETE);
      x--;
    }
  }
  while (x > 0 && y > 0) {
    reversed.push(KEEP);
    x--;
    y--;
  }
  reversed.reverse();
  return Uint8Array.from(reversed);
}

function buildOps(oldIds, newIds) {
  const oldLength = oldIds.length;
  const newLength = newIds.length;
  const shortest = oldLength < newLength ? oldLength : newLength;
  let prefix = 0;
  while (prefix < shortest && oldIds[prefix] === newIds[prefix]) prefix++;
  let suffix = 0;
  const suffixLimit = shortest - prefix;
  while (
    suffix < suffixLimit &&
    oldIds[oldLength - 1 - suffix] === newIds[newLength - 1 - suffix]
  ) {
    suffix++;
  }

  const middle = middleOps(
    oldIds,
    newIds,
    prefix,
    prefix,
    oldLength - prefix - suffix,
    newLength - prefix - suffix,
  );
  const ops = new Uint8Array(prefix + middle.length + suffix);
  ops.set(middle, prefix);
  return ops;
}

function appendLine(parts, prefix, line) {
  parts.push(prefix + line);
  if (line.length === 0 || line.charCodeAt(line.length - 1) !== 10) {
    parts.push('\n%\n');
  }
}

export function run(input) {
  const oldLines = splitLines(input.old);
  const newLines = splitLines(input.new);
  const [oldIds, newIds] = encodeLines(oldLines, newLines);
  const ops = buildOps(oldIds, newIds);

  const oldPositions = new Int32Array(ops.length + 1);
  const newPositions = new Int32Array(ops.length + 1);
  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    oldPositions[i + 1] = oldPositions[i] + (op === INSERT ? 0 : 1);
    newPositions[i + 1] = newPositions[i] + (op === DELETE ? 0 : 1);
    if (op === DELETE) deleted++;
    else if (op === INSERT) inserted++;
  }

  const hunks = [];
  let firstChange = -1;
  let previousChange = -1;
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === KEEP) continue;
    if (firstChange === -1) {
      firstChange = i;
    } else if (i - previousChange - 1 > 6) {
      hunks.push([firstChange, previousChange]);
      firstChange = i;
    }
    previousChange = i;
  }
  if (firstChange !== -1) hunks.push([firstChange, previousChange]);

  const parts = [
    `makefun-diff/1 old=${oldLines.length} new=${newLines.length} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`,
  ];

  for (const [first, last] of hunks) {
    const start = first > 3 ? first - 3 : 0;
    const end = last + 4 < ops.length ? last + 4 : ops.length;
    const oldStart = oldPositions[start];
    const newStart = newPositions[start];
    parts.push(
      `@ ${oldStart + 1} ${oldPositions[end] - oldStart} ${newStart + 1} ${newPositions[end] - newStart}\n`,
    );

    let oldIndex = oldStart;
    let newIndex = newStart;
    let i = start;
    while (i < end) {
      if (ops[i] === KEEP) {
        appendLine(parts, '=', oldLines[oldIndex]);
        oldIndex++;
        newIndex++;
        i++;
      } else {
        const deletions = [];
        const insertions = [];
        while (i < end && ops[i] !== KEEP) {
          if (ops[i] === DELETE) deletions.push(oldLines[oldIndex++]);
          else insertions.push(newLines[newIndex++]);
          i++;
        }
        for (const line of deletions) appendLine(parts, '-', line);
        for (const line of insertions) appendLine(parts, '+', line);
      }
    }
  }

  return parts.join('');
}
