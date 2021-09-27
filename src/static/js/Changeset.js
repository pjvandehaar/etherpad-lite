'use strict';

/*
 * This is the Changeset library copied from the old Etherpad with some modifications
 * to use it in node.js
 * Can be found in https://github.com/ether/pad/blob/master/infrastructure/ace/www/easysync2.js
 */

/*
 * This code is mostly from the old Etherpad. Please help us to comment this code.
 * This helps other people to understand this code better and helps them to improve it.
 * TL;DR COMMENTS ON THIS FILE ARE HIGHLY APPRECIATED
 */

/*
 * Copyright 2009 Google Inc., 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const AttributePool = require('./AttributePool');

const warnDeprecated = (...args) => {
  const err = new Error();
  if (Error.captureStackTrace) Error.captureStackTrace(err, warnDeprecated);
  err.name = '';
  if (err.stack) args.push(err.stack);
  console.warn(...args);
};

/**
 * This method is called whenever there is an error in the sync process.
 *
 * @param {string} msg - Just some message
 */
const error = (msg) => {
  const e = new Error(msg);
  e.easysync = true;
  throw e;
};

/**
 * Assert that a condition is truthy. If the condition is falsy, the `error` function is called to
 * throw an exception.
 *
 * @param {boolean} b - assertion condition
 * @param {...string} msgParts - error message to include in the exception
 */
const assert = (b, ...msgParts) => {
  if (!b) {
    error(`Failed assertion: ${msgParts.join('')}`);
  }
};

/**
 * Parses a number from string base 36.
 *
 * @param {string} str - string of the number in base 36
 * @returns {number} number
 */
exports.parseNum = (str) => parseInt(str, 36);

/**
 * Writes a number in base 36 and puts it in a string.
 *
 * @param {number} num - number
 * @returns {string} string
 */
exports.numToString = (num) => num.toString(36).toLowerCase();

/**
 * An operation to apply to a shared document.
 */
exports.Op = class {
  /**
   * @param {(''|'='|'+'|'-')} [opcode=''] - The operation's operator.
   */
  constructor(opcode = '') {
    /**
     * The operation's operator: '=' (keep), '+' (insert), or '-' (delete). This may also be '' to
     * create a null (invalid) operation, which is sometimes used to indicate the lack of an
     * operation.
     *
     * @type {(''|'='|'+'|'-')}
     * @public
     */
    this.opcode = opcode;

    /**
     * The number of characters to keep, insert, or delete.
     *
     * @type {number}
     * @public
     */
    this.chars = 0;

    /**
     * The number of characters among the `chars` characters that are newlines.
     *
     * @type {number}
     * @public
     */
    this.lines = 0;

    /**
     * Stores the attributes that apply to the characters ('+' and '-' ops only). Represented as a
     * repeated sequence of '*I' where I is a base-36 integer identifying the attribute in the
     * attribute pool.
     *
     * @type {string}
     * @public
     */
    this.attribs = '';
  }

  toString() {
    if (!this.opcode) throw new TypeError('null op');
    if (typeof this.attribs !== 'string') throw new TypeError('attribs must be a string');
    const l = this.lines ? `|${exports.numToString(this.lines)}` : '';
    return this.attribs + l + this.opcode + exports.numToString(this.chars);
  }
};

/**
 * Describes changes to apply to a document. Does not include the attribute pool or the original
 * document.
 *
 * @typedef {object} Changeset
 * @property {number} oldLen -
 * @property {number} newLen -
 * @property {string} ops -
 * @property {string} charBank -
 */

/**
 * Returns the required length of the text before changeset can be applied.
 *
 * @param {string} cs - String representation of the Changeset
 * @returns {number} oldLen property
 */
exports.oldLen = (cs) => exports.unpack(cs).oldLen;

/**
 * Returns the length of the text after changeset is applied.
 *
 * @param {string} cs - String representation of the Changeset
 * @returns {number} newLen property
 */
exports.newLen = (cs) => exports.unpack(cs).newLen;

/**
 * Iterator over a changeset's operations.
 *
 * Note: This class implements the ECMAScript iterable protocol, but NOT the iterator protocol.
 */
exports.OpIter = class {
  /**
   * @param {string} opsStr - String encoding the change operations to iterate over.
   */
  constructor(opsStr) {
    this._opsStr = opsStr;
    this._regex = /((?:\*[0-9a-z]+)*)(?:\|([0-9a-z]+))?([-+=])([0-9a-z]+)|\?|/g;
    this._curIndex = 0;
    this._prevIndex = 0;
    this._regexResult = this._nextRegexMatch();
  }

  _nextRegexMatch() {
    this._prevIndex = this._curIndex;
    this._regex.lastIndex = this._curIndex;
    const result = this._regex.exec(this._opsStr);
    this._curIndex = this._regex.lastIndex;
    if (result[0] === '?') {
      error('Hit error opcode in op stream');
    }
    return result;
  }

  /**
   * @returns {boolean} Whether there are any remaining operations.
   */
  hasNext() {
    return !!(this._regexResult[0]);
  }

  /**
   * Returns the next operation object and advances the iterator.
   *
   * Note: This does NOT implement the ECMAScript iterator protocol.
   *
   * @throws {Error} If there are no more operations.
   * @returns {Op} The next operation.
   */
  next() {
    if (!this.hasNext()) throw new Error('no more operations');
    const op = new exports.Op(this._regexResult[3]);
    op.attribs = this._regexResult[1];
    op.lines = exports.parseNum(this._regexResult[2] || 0);
    op.chars = exports.parseNum(this._regexResult[4]);
    this._regexResult = this._nextRegexMatch();
    return op;
  }

  /**
   * Implements the ECMAScript iterable protocol.
   *
   * @returns Iterator over the operations.
   */
  [Symbol.iterator]() {
    return {
      /**
       * Implements the ECMAScript iterator protocol.
       */
      next: () => {
        const done = !this.hasNext();
        return {done, value: done ? undefined : this.next()};
      },
    };
  }
};

/**
 * @deprecated Use `OpIter` instead.
 */
class LegacyOpIter extends exports.OpIter {
  /**
   * @param {string} opsStr - String encoding of the change operations to perform.
   * @param {number} [startIndex=0] - Start position in `opsStr`.
   */
  constructor(opsStr, startIndex = 0) {
    if (startIndex) opsStr = opsStr.slice(startIndex);
    super(opsStr);
    this._startIndex = startIndex;
  }

  /**
   * Returns the next operation object and advances the iterator.
   *
   * Note: This does NOT implement the ECMAScript iterator protocol.
   *
   * @param {Op} [opOut] - Deprecated. Operation object to recycle for the return value.
   * @returns {Op} The next operation, or an operation with a falsy `opcode` property if there are
   *     no more operations.
   */
  next(opOut = new exports.Op()) {
    if (this.hasNext()) {
      const op = super.next();
      copyOp(op, opOut);
    } else {
      clearOp(opOut);
    }
    return opOut;
  }

  lastIndex() {
    return this._prevIndex + this._startIndex;
  }
}

/**
 * Creates an iterator which decodes string changeset operations.
 * @deprecated Use the `OpIter` class instead.
 * @param {string} opsStr - String encoding of the change operations to be performed.
 * @param {number} optStartIndex - From where in the string should the iterator start.
 * @returns Operator iterator object.
 */
exports.opIterator = (opsStr, optStartIndex) => {
  warnDeprecated('Changeset.opIterator() is deprecated; use the Changeset.OpIter class instead');
  return new LegacyOpIter(opsStr, optStartIndex);
};

/**
 * Cleans an Op object.
 *
 * @param {Op} op - object to clear
 */
const clearOp = (op) => {
  op.opcode = '';
  op.chars = 0;
  op.lines = 0;
  op.attribs = '';
};

/**
 * Creates a new Op object
 *
 * @deprecated Use the `Op` class instead.
 * @param {('+'|'-'|'='|'')} [optOpcode=''] - The operation's operator.
 * @returns {Op}
 */
exports.newOp = (optOpcode) => {
  warnDeprecated('Changeset.newOp() is deprecated; use the Changeset.Op class instead');
  return new exports.Op(optOpcode);
};

/**
 * Copies op1 to op2
 *
 * @param {Op} op1 - src Op
 * @param {Op} [op2] - dest Op. If not given, a new Op is used.
 * @returns op2
 */
const copyOp = (op1, op2 = new exports.Op()) => Object.assign(op2, op1);

/**
 * Serializes a sequence of Ops.
 */
class OpAssembler {
  constructor() {
    this._pieces = [];
  }

  /**
   * @param {Op} op - Operation to add. Ownership remains with the caller.
   */
  append(op) {
    assert(op instanceof exports.Op, 'argument must be an instance of Op');
    this._pieces.push(op.toString());
  }

  toString() {
    return this._pieces.join('');
  }

  clear() {
    this._pieces.length = 0;
  }
}

/**
 * Efficiently merges consecutive operations that are mergeable, ignores no-ops, and drops final
 * pure "keeps". It does not re-order operations.
 */
class MergingOpAssembler {
  constructor() {
    this._assem = new OpAssembler();
    this._bufOp = new exports.Op();
    // If we get, for example, insertions [xxx\n,yyy], those don't merge, but if we get
    // [xxx\n,yyy,zzz\n], that merges to [xxx\nyyyzzz\n]. This variable stores the length of yyy and
    // any other newline-less ops immediately after it.
    this._bufOpAdditionalCharsAfterNewline = 0;
  }

  _flush(isEndDocument) {
    if (!this._bufOp.opcode) return;
    if (isEndDocument && this._bufOp.opcode === '=' && !this._bufOp.attribs) {
      // final merged keep, leave it implicit
    } else {
      this._assem.append(this._bufOp);
      if (this._bufOpAdditionalCharsAfterNewline) {
        this._bufOp.chars = this._bufOpAdditionalCharsAfterNewline;
        this._bufOp.lines = 0;
        this._assem.append(this._bufOp);
        this._bufOpAdditionalCharsAfterNewline = 0;
      }
    }
    this._bufOp.opcode = '';
  }

  append(op) {
    if (op.chars <= 0) return;
    if (this._bufOp.opcode === op.opcode && this._bufOp.attribs === op.attribs) {
      if (op.lines > 0) {
        // this._bufOp and additional chars are all mergeable into a multi-line op
        this._bufOp.chars += this._bufOpAdditionalCharsAfterNewline + op.chars;
        this._bufOp.lines += op.lines;
        this._bufOpAdditionalCharsAfterNewline = 0;
      } else if (this._bufOp.lines === 0) {
        // both this._bufOp and op are in-line
        this._bufOp.chars += op.chars;
      } else {
        // append in-line text to multi-line this._bufOp
        this._bufOpAdditionalCharsAfterNewline += op.chars;
      }
    } else {
      this._flush();
      copyOp(op, this._bufOp);
    }
  }

  endDocument() {
    this._flush(true);
  }

  toString() {
    this._flush();
    return this._assem.toString();
  }

  clear() {
    this._assem.clear();
    clearOp(this._bufOp);
  }
}

/**
 * Creates an object that allows you to append operations (type Op) and also compresses them if
 * possible. Like MergingOpAssembler, but able to produce conforming exportss from slightly looser
 * input, at the cost of speed. Specifically:
 *   - merges consecutive operations that can be merged
 *   - strips final "="
 *   - ignores 0-length changes
 *   - reorders consecutive + and - (which MergingOpAssembler doesn't do)
 */
class SmartOpAssembler {
  constructor() {
    this._minusAssem = new MergingOpAssembler();
    this._plusAssem = new MergingOpAssembler();
    this._keepAssem = new MergingOpAssembler();
    this._assem = exports.stringAssembler();
    this._lastOpcode = '';
    this._lengthChange = 0;
  }

  _flushKeeps() {
    this._assem.append(this._keepAssem.toString());
    this._keepAssem.clear();
  }

  _flushPlusMinus() {
    this._assem.append(this._minusAssem.toString());
    this._minusAssem.clear();
    this._assem.append(this._plusAssem.toString());
    this._plusAssem.clear();
  }

  append(op) {
    if (!op.opcode) return;
    if (!op.chars) return;

    if (op.opcode === '-') {
      if (this._lastOpcode === '=') {
        this._flushKeeps();
      }
      this._minusAssem.append(op);
      this._lengthChange -= op.chars;
    } else if (op.opcode === '+') {
      if (this._lastOpcode === '=') {
        this._flushKeeps();
      }
      this._plusAssem.append(op);
      this._lengthChange += op.chars;
    } else if (op.opcode === '=') {
      if (this._lastOpcode !== '=') {
        this._flushPlusMinus();
      }
      this._keepAssem.append(op);
    }
    this._lastOpcode = op.opcode;
  }

  appendOpWithText(opcode, text, attribs, pool) {
    const op = new exports.Op(opcode);
    op.attribs = exports.makeAttribsString(opcode, attribs, pool);
    const lastNewlinePos = text.lastIndexOf('\n');
    if (lastNewlinePos < 0) {
      op.chars = text.length;
      op.lines = 0;
      this.append(op);
    } else {
      op.chars = lastNewlinePos + 1;
      op.lines = text.match(/\n/g).length;
      this.append(op);
      op.chars = text.length - (lastNewlinePos + 1);
      op.lines = 0;
      this.append(op);
    }
  }

  toString() {
    this._flushPlusMinus();
    this._flushKeeps();
    return this._assem.toString();
  }

  clear() {
    this._minusAssem.clear();
    this._plusAssem.clear();
    this._keepAssem.clear();
    this._assem.clear();
    this._lengthChange = 0;
  }

  endDocument() {
    this._keepAssem.endDocument();
  }

  getLengthChange() {
    return this._lengthChange;
  }
}

/**
 * Used to check if a Changeset is valid. This function does not check things that require access to
 * the attribute pool (e.g., attribute order) or original text (e.g., newline positions).
 *
 * @param {string} cs - Changeset to check
 * @returns {string} the checked Changeset
 */
exports.checkRep = (cs) => {
  const unpacked = exports.unpack(cs);
  const oldLen = unpacked.oldLen;
  const newLen = unpacked.newLen;
  const ops = unpacked.ops;
  let charBank = unpacked.charBank;

  const assem = new SmartOpAssembler();
  let oldPos = 0;
  let calcNewLen = 0;
  let numInserted = 0;
  for (const o of new exports.OpIter(ops)) {
    switch (o.opcode) {
      case '=':
        oldPos += o.chars;
        calcNewLen += o.chars;
        break;
      case '-':
        oldPos += o.chars;
        assert(oldPos <= oldLen, oldPos, ' > ', oldLen, ' in ', cs);
        break;
      case '+':
      {
        calcNewLen += o.chars;
        numInserted += o.chars;
        assert(calcNewLen <= newLen, calcNewLen, ' > ', newLen, ' in ', cs);
        break;
      }
    }
    assem.append(o);
  }

  calcNewLen += oldLen - oldPos;
  charBank = charBank.substring(0, numInserted);
  while (charBank.length < numInserted) {
    charBank += '?';
  }

  assem.endDocument();
  const normalized = exports.pack(oldLen, calcNewLen, assem.toString(), charBank);
  assert(normalized === cs, 'Invalid changeset (checkRep failed)');

  return cs;
};

/**
 * @returns {SmartOpAssembler}
 */
exports.smartOpAssembler = () => new SmartOpAssembler();

/**
 * @returns {MergingOpAssembler}
 */
exports.mergingOpAssembler = () => new MergingOpAssembler();

/**
 * @returns {OpAssembler}
 */
exports.opAssembler = () => new OpAssembler();

/**
 * A custom made String Iterator
 *
 * @typedef {object} StringIterator
 * @property {Function} newlines -
 * @property {Function} peek -
 * @property {Function} remaining -
 * @property {Function} skip -
 * @property {Function} take -
 */

/**
 * @param {string} str - String to iterate over
 * @returns {StringIterator}
 */
exports.stringIterator = (str) => {
  let curIndex = 0;
  // newLines is the number of \n between curIndex and str.length
  let newLines = str.split('\n').length - 1;
  const getnewLines = () => newLines;

  const assertRemaining = (n) => {
    assert(n <= remaining(), '!(', n, ' <= ', remaining(), ')');
  };

  const take = (n) => {
    assertRemaining(n);
    const s = str.substr(curIndex, n);
    newLines -= s.split('\n').length - 1;
    curIndex += n;
    return s;
  };

  const peek = (n) => {
    assertRemaining(n);
    const s = str.substr(curIndex, n);
    return s;
  };

  const skip = (n) => {
    assertRemaining(n);
    curIndex += n;
  };

  const remaining = () => str.length - curIndex;
  return {
    take,
    skip,
    remaining,
    peek,
    newlines: getnewLines,
  };
};

/**
 * A custom made StringBuffer
 *
 * @typedef {object} StringAssembler
 * @property {Function} append -
 * @property {Function} toString -
 */

/**
 * @returns {StringAssembler}
 */
exports.stringAssembler = () => {
  const pieces = [];

  /**
   * @param {string} x -
   */
  const append = (x) => {
    pieces.push(String(x));
  };

  const toString = () => pieces.join('');
  return {
    append,
    toString,
  };
};

/**
 * Class to iterate and modify texts which have several lines. It is used for applying Changesets on
 * arrays of lines.
 *
 * Mutation operations have the same constraints as exports operations with respect to newlines, but
 * not the other additional constraints (i.e. ins/del ordering, forbidden no-ops, non-mergeability,
 * final newline). Can be used to mutate lists of strings where the last char of each string is not
 * actually a newline, but for the purposes of N and L values, the caller should pretend it is, and
 * for things to work right in that case, the input to the `insert` method should be a single line
 * with no newlines.
 */
class TextLinesMutator {
  /**
   * @param {string[]} lines - Lines to mutate (in place). This does not need to be an array as long
   *     as it supports certain methods/properties:
   *       - `get(i)`: Returns the line at index `i`.
   *       - `length`: Number like `Array.prototype.length`, or a method that returns the length.
   *       - `slice(...)`: Like `Array.prototype.slice(...)`. Optional if the return value of the
   *         `removeLines` method is not needed.
   *       - `splice(...)`: Like `Array.prototype.splice(...)`.
   */
  constructor(lines) {
    this._lines = lines;
    // this._curSplice holds information which lines are to be deleted or changed:
    //   - this._curSplice[0] is an index into the this._lines array
    //   - this._curSplice[1] is the number of lines that will be removed from this._lines
    //   - the other elements represent mutated (changed by ops) lines or new lines (added by ops)
    this._curSplice = [0, 0];
    this._inSplice = false;
    // position in lines after curSplice is applied:
    this._curLine = 0;
    this._curCol = 0;
    // invariant: if (inSplice) then (curLine is in curSplice[0] + curSplice.length - {2,3}) &&
    //            curLine >= curSplice[0]
    // invariant: if (inSplice && (curLine >= curSplice[0] + curSplice.length - 2)) then
    //            curCol == 0
  }

  /**
   * Get a line from `lines` at given index.
   *
   * @param {number} idx - an index
   * @returns {string}
   */
  _linesGet(idx) {
    if (this._lines.get) {
      return this._lines.get(idx);
    } else {
      return this._lines[idx];
    }
  }

  /**
   * Return a slice from `lines`.
   *
   * @param {number} start - the start index
   * @param {number} end - the end index
   * @returns {string[]}
   */
  _linesSlice(start, end) {
    // can be unimplemented if removeLines's return value not needed
    if (this._lines.slice) {
      return this._lines.slice(start, end);
    } else {
      return [];
    }
  }

  /**
   * Return the length of `lines`.
   *
   * @returns {number}
   */
  _linesLength() {
    if (typeof this._lines.length === 'number') {
      return this._lines.length;
    } else {
      return this._lines.length();
    }
  }

  /**
   * Starts a new splice.
   */
  _enterSplice() {
    this._curSplice[0] = this._curLine;
    this._curSplice[1] = 0;
    // TODO(doc) when is this the case?
    //           check all enterSplice calls and changes to curCol
    if (this._curCol > 0) this._putCurLineInSplice();
    this._inSplice = true;
  }

  /**
   * Changes the lines array according to the values in curSplice and resets curSplice. Called via
   * close or TODO(doc).
   */
  _leaveSplice() {
    this._lines.splice(...this._curSplice);
    this._curSplice.length = 2;
    this._curSplice[0] = this._curSplice[1] = 0;
    this._inSplice = false;
  }

  /**
   * Indicates if curLine is already in the splice. This is necessary because the last element in
   * curSplice is curLine when this line is currently worked on (e.g. when skipping are inserting).
   *
   * TODO(doc) why aren't removals considered?
   *
   * @returns {boolean} true if curLine is in splice
   */
  _isCurLineInSplice() {
    return this._curLine - this._curSplice[0] < this._curSplice.length - 2;
  }

  /**
   * Incorporates current line into the splice and marks its old position to be deleted.
   *
   * @returns {number} the index of the added line in curSplice
   */
  _putCurLineInSplice() {
    if (!this._isCurLineInSplice()) {
      this._curSplice.push(this._linesGet(this._curSplice[0] + this._curSplice[1]));
      this._curSplice[1]++;
    }
    // TODO should be the same as this._curSplice.length - 1
    return 2 + this._curLine - this._curSplice[0];
  }

  /**
   * It will skip some newlines by putting them into the splice.
   *
   * @param {number} L -
   * @param {boolean} includeInSplice - indicates if attributes are present
   */
  skipLines(L, includeInSplice) {
    if (!L) return;
    if (includeInSplice) {
      if (!this._inSplice) this._enterSplice();
      // TODO(doc) should this count the number of characters that are skipped to check?
      for (let i = 0; i < L; i++) {
        this._curCol = 0;
        this._putCurLineInSplice();
        this._curLine++;
      }
    } else {
      if (this._inSplice) {
        if (L > 1) {
          // TODO(doc) figure out why single lines are incorporated into splice instead of ignored
          this._leaveSplice();
        } else {
          this._putCurLineInSplice();
        }
      }
      this._curLine += L;
      this._curCol = 0;
    }
    // tests case foo in remove(), which isn't otherwise covered in current impl
  }

  /**
   * Skip some characters. Can contain newlines.
   *
   * @param {number} N - number of characters to skip
   * @param {number} L - number of newlines to skip
   * @param {boolean} includeInSplice - indicates if attributes are present
   */
  skip(N, L, includeInSplice) {
    if (!N) return;
    if (L) {
      this.skipLines(L, includeInSplice);
    } else {
      if (includeInSplice && !this._inSplice) this._enterSplice();
      if (this._inSplice) {
        // although the line is put into splice curLine is not increased, because
        // only some chars are skipped, not the whole line
        this._putCurLineInSplice();
      }
      this._curCol += N;
    }
  }

  /**
   * Remove whole lines from lines array.
   *
   * @param {number} L - number of lines to remove
   * @returns {string}
   */
  removeLines(L) {
    if (!L) return '';
    if (!this._inSplice) this._enterSplice();

    /**
     * Gets a string of joined lines after the end of the splice.
     *
     * @param {number} k - number of lines
     * @returns {string} joined lines
     */
    const nextKLinesText = (k) => {
      const m = this._curSplice[0] + this._curSplice[1];
      return this._linesSlice(m, m + k).join('');
    };

    let removed = '';
    if (this._isCurLineInSplice()) {
      if (this._curCol === 0) {
        removed = this._curSplice[this._curSplice.length - 1];
        this._curSplice.length--;
        removed += nextKLinesText(L - 1);
        this._curSplice[1] += L - 1;
      } else {
        removed = nextKLinesText(L - 1);
        this._curSplice[1] += L - 1;
        const sline = this._curSplice.length - 1;
        removed = this._curSplice[sline].substring(this._curCol) + removed;
        this._curSplice[sline] = this._curSplice[sline].substring(0, this._curCol) +
            this._linesGet(this._curSplice[0] + this._curSplice[1]);
        this._curSplice[1] += 1;
      }
    } else {
      removed = nextKLinesText(L);
      this._curSplice[1] += L;
    }
    return removed;
  }

  /**
   * Remove text from lines array.
   *
   * @param {number} N - characters to delete
   * @param {number} L - lines to delete
   * @returns {string}
   */
  remove(N, L) {
    if (!N) return '';
    if (L) return this.removeLines(L);
    if (!this._inSplice) this._enterSplice();
    // although the line is put into splice, curLine is not increased, because
    // only some chars are removed not the whole line
    const sline = this._putCurLineInSplice();
    const removed = this._curSplice[sline].substring(this._curCol, this._curCol + N);
    this._curSplice[sline] = this._curSplice[sline].substring(0, this._curCol) +
        this._curSplice[sline].substring(this._curCol + N);
    return removed;
  }

  /**
   * Inserts text into lines array.
   *
   * @param {string} text - the text to insert
   * @param {number} L - number of newlines in text
   */
  insert(text, L) {
    if (!text) return;
    if (!this._inSplice) this._enterSplice();
    if (L) {
      const newLines = exports.splitTextLines(text);
      if (this._isCurLineInSplice()) {
        const sline = this._curSplice.length - 1;
        const theLine = this._curSplice[sline];
        const lineCol = this._curCol;
        // insert the first new line
        this._curSplice[sline] = theLine.substring(0, lineCol) + newLines[0];
        this._curLine++;
        newLines.splice(0, 1);
        // insert the remaining new lines
        Array.prototype.push.apply(this._curSplice, newLines);
        this._curLine += newLines.length;
        // insert the remaining chars from the "old" line (e.g. the line we were in
        // when we started to insert new lines)
        this._curSplice.push(theLine.substring(lineCol));
        this._curCol = 0; // TODO(doc) why is this not set to the length of last line?
      } else {
        Array.prototype.push.apply(this._curSplice, newLines);
        this._curLine += newLines.length;
      }
    } else {
      // there are no additional lines
      // although the line is put into splice, curLine is not increased, because
      // there may be more chars in the line (newline is not reached)
      const sline = this._putCurLineInSplice();
      if (!this._curSplice[sline]) {
        const err = new Error(
            'curSplice[sline] not populated, actual curSplice contents is ' +
            `${JSON.stringify(this._curSplice)}. Possibly related to ` +
            'https://github.com/ether/etherpad-lite/issues/2802');
        console.error(err.stack || err.toString());
      }
      this._curSplice[sline] = this._curSplice[sline].substring(0, this._curCol) + text +
          this._curSplice[sline].substring(this._curCol);
      this._curCol += text.length;
    }
  }

  /**
   * Checks if curLine (the line we are in when curSplice is applied) is the last line in `lines`.
   *
   * @returns {boolean} indicates if there are lines left
   */
  hasMore() {
    let docLines = this._linesLength();
    if (this._inSplice) {
      docLines += this._curSplice.length - 2 - this._curSplice[1];
    }
    return this._curLine < docLines;
  }

  /**
   * Closes the splice
   */
  close() {
    if (this._inSplice) this._leaveSplice();
  }
}

/**
 * Apply operations to other operations.
 *
 * @param {string} in1 - first Op string
 * @param {string} in2 - second Op string
 * @param {Function} func - Callback that applies an operation to another operation. Will be called
 *     multiple times depending on the number of operations in `in1` and `in2`. `func` has signature
 *     `opOut = f(op1, op2)`:
 *       - `op1` is the current operation from `in1`. `func` is expected to mutate `op1` to
 *         partially or fully consume it, and MUST set `op1.opcode` to the empty string once `op1`
 *         is fully consumed. If `op1` is not fully consumed, `func` will be called again with the
 *         same `op1` value. If `op1` is fully consumed, the next call to `func` will be given the
 *         next operation from `in1`. If there are no more operations in `in1`, `op1.opcode` will be
 *         the empty string.
 *       - `op2` is the current operation from `in2`, to apply to `op1`. Has the same consumption
 *         and advancement semantics as `op1`.
 *       - `opOut` is the result of applying `op2` (before consumption) to `op1` (before
 *         consumption). If there is no result (perhaps `op1` and `op2` cancelled each other out),
 *         either `opOut` must be nullish or `opOut.opcode` must be the empty string.
 * @returns {string} the integrated changeset
 */
const applyZip = (in1, in2, func) => {
  const iter1 = new exports.OpIter(in1);
  const iter2 = new exports.OpIter(in2);
  const assem = new SmartOpAssembler();
  let op1 = new exports.Op();
  let op2 = new exports.Op();
  while (op1.opcode || iter1.hasNext() || op2.opcode || iter2.hasNext()) {
    if (!op1.opcode && iter1.hasNext()) op1 = iter1.next();
    if (!op2.opcode && iter2.hasNext()) op2 = iter2.next();
    const opOut = func(op1, op2);
    if (opOut && opOut.opcode) assem.append(opOut);
  }
  assem.endDocument();
  return assem.toString();
};

/**
 * Parses an encoded changeset.
 *
 * @param {string} cs - The encoded changeset.
 * @returns {Changeset}
 */
exports.unpack = (cs) => {
  const headerRegex = /Z:([0-9a-z]+)([><])([0-9a-z]+)|/;
  const headerMatch = headerRegex.exec(cs);
  if ((!headerMatch) || (!headerMatch[0])) {
    error(`Not a exports: ${cs}`);
  }
  const oldLen = exports.parseNum(headerMatch[1]);
  const changeSign = (headerMatch[2] === '>') ? 1 : -1;
  const changeMag = exports.parseNum(headerMatch[3]);
  const newLen = oldLen + changeSign * changeMag;
  const opsStart = headerMatch[0].length;
  let opsEnd = cs.indexOf('$');
  if (opsEnd < 0) opsEnd = cs.length;
  return {
    oldLen,
    newLen,
    ops: cs.substring(opsStart, opsEnd),
    charBank: cs.substring(opsEnd + 1),
  };
};

/**
 * Creates an encoded changeset.
 *
 * @param {number} oldLen - The length of the document before applying the changeset.
 * @param {number} newLen - The length of the document after applying the changeset.
 * @param {string} opsStr - Encoded operations to apply to the document.
 * @param {string} bank - Characters for insert operations.
 * @returns {string} The encoded changeset.
 */
exports.pack = (oldLen, newLen, opsStr, bank) => {
  const lenDiff = newLen - oldLen;
  const lenDiffStr = (lenDiff >= 0 ? `>${exports.numToString(lenDiff)}`
    : `<${exports.numToString(-lenDiff)}`);
  const a = [];
  a.push('Z:', exports.numToString(oldLen), lenDiffStr, opsStr, '$', bank);
  return a.join('');
};

/**
 * Applies a Changeset to a string.
 *
 * @param {string} cs - String encoded Changeset
 * @param {string} str - String to which a Changeset should be applied
 * @returns {string}
 */
exports.applyToText = (cs, str) => {
  const unpacked = exports.unpack(cs);
  assert(str.length === unpacked.oldLen, 'mismatched apply: ', str.length, ' / ', unpacked.oldLen);
  const bankIter = exports.stringIterator(unpacked.charBank);
  const strIter = exports.stringIterator(str);
  const assem = exports.stringAssembler();
  for (const op of new exports.OpIter(unpacked.ops)) {
    switch (op.opcode) {
      case '+':
      // op is + and op.lines 0: no newlines must be in op.chars
      // op is + and op.lines >0: op.chars must include op.lines newlines
        if (op.lines !== bankIter.peek(op.chars).split('\n').length - 1) {
          throw new Error(`newline count is wrong in op +; cs:${cs} and text:${str}`);
        }
        assem.append(bankIter.take(op.chars));
        break;
      case '-':
      // op is - and op.lines 0: no newlines must be in the deleted string
      // op is - and op.lines >0: op.lines newlines must be in the deleted string
        if (op.lines !== strIter.peek(op.chars).split('\n').length - 1) {
          throw new Error(`newline count is wrong in op -; cs:${cs} and text:${str}`);
        }
        strIter.skip(op.chars);
        break;
      case '=':
      // op is = and op.lines 0: no newlines must be in the copied string
      // op is = and op.lines >0: op.lines newlines must be in the copied string
        if (op.lines !== strIter.peek(op.chars).split('\n').length - 1) {
          throw new Error(`newline count is wrong in op =; cs:${cs} and text:${str}`);
        }
        assem.append(strIter.take(op.chars));
        break;
    }
  }
  assem.append(strIter.take(strIter.remaining()));
  return assem.toString();
};

/**
 * Applies a changeset on an array of lines.
 *
 * @param {string} cs - the changeset to apply
 * @param {string[]} lines - The lines to which the changeset needs to be applied
 */
exports.mutateTextLines = (cs, lines) => {
  const unpacked = exports.unpack(cs);
  const bankIter = exports.stringIterator(unpacked.charBank);
  const mut = new TextLinesMutator(lines);
  for (const op of new exports.OpIter(unpacked.ops)) {
    switch (op.opcode) {
      case '+':
        mut.insert(bankIter.take(op.chars), op.lines);
        break;
      case '-':
        mut.remove(op.chars, op.lines);
        break;
      case '=':
        mut.skip(op.chars, op.lines, (!!op.attribs));
        break;
    }
  }
  mut.close();
};

/**
 * Composes two attribute strings (see below) into one.
 *
 * @param {string} att1 - first attribute string
 * @param {string} att2 - second attribue string
 * @param {boolean} resultIsMutation -
 * @param {AttributePool} pool - attribute pool
 * @returns {string}
 */
exports.composeAttributes = (att1, att2, resultIsMutation, pool) => {
  // att1 and att2 are strings like "*3*f*1c", asMutation is a boolean.
  // Sometimes attribute (key,value) pairs are treated as attribute presence
  // information, while other times they are treated as operations that
  // mutate a set of attributes, and this affects whether an empty value
  // is a deletion or a change.
  // Examples, of the form (att1Items, att2Items, resultIsMutation) -> result
  // ([], [(bold, )], true) -> [(bold, )]
  // ([], [(bold, )], false) -> []
  // ([], [(bold, true)], true) -> [(bold, true)]
  // ([], [(bold, true)], false) -> [(bold, true)]
  // ([(bold, true)], [(bold, )], true) -> [(bold, )]
  // ([(bold, true)], [(bold, )], false) -> []
  // pool can be null if att2 has no attributes.
  if ((!att1) && resultIsMutation) {
    // In the case of a mutation (i.e. composing two exportss),
    // an att2 composed with an empy att1 is just att2.  If att1
    // is part of an attribution string, then att2 may remove
    // attributes that are already gone, so don't do this optimization.
    return att2;
  }
  if (!att2) return att1;
  const atts = [];
  att1.replace(/\*([0-9a-z]+)/g, (_, a) => {
    atts.push(pool.getAttrib(exports.parseNum(a)));
    return '';
  });
  att2.replace(/\*([0-9a-z]+)/g, (_, a) => {
    const pair = pool.getAttrib(exports.parseNum(a));
    let found = false;
    for (let i = 0; i < atts.length; i++) {
      const oldPair = atts[i];
      if (oldPair[0] !== pair[0]) continue;
      if (pair[1] || resultIsMutation) {
        oldPair[1] = pair[1];
      } else {
        atts.splice(i, 1);
      }
      found = true;
      break;
    }
    if ((!found) && (pair[1] || resultIsMutation)) {
      atts.push(pair);
    }
    return '';
  });
  atts.sort();
  const buf = exports.stringAssembler();
  for (let i = 0; i < atts.length; i++) {
    buf.append('*');
    buf.append(exports.numToString(pool.putAttrib(atts[i])));
  }
  return buf.toString();
};

/**
 * Function used as parameter for applyZip to apply a Changeset to an attribute.
 *
 * @param {Op} attOp - The op from the sequence that is being operated on, either an attribution
 *     string or the earlier of two exportss being composed.
 * @param {Op} csOp -
 * @param {AttributePool} pool - Can be null if definitely not needed.
 * @returns {Op} The result of applying `csOp` to `attOp`.
 */
const slicerZipperFunc = (attOp, csOp, pool) => {
  const opOut = new exports.Op();
  if (!attOp.opcode) {
    copyOp(csOp, opOut);
    csOp.opcode = '';
  } else if (!csOp.opcode) {
    copyOp(attOp, opOut);
    attOp.opcode = '';
  } else if (attOp.opcode === '-') {
    copyOp(attOp, opOut);
    attOp.opcode = '';
  } else if (csOp.opcode === '+') {
    copyOp(csOp, opOut);
    csOp.opcode = '';
  } else {
    for (const op of [attOp, csOp]) {
      assert(op.chars >= op.lines, `op has more newlines than chars: ${op.toString()}`);
    }
    assert(
        attOp.chars < csOp.chars ? attOp.lines <= csOp.lines
        : attOp.chars > csOp.chars ? attOp.lines >= csOp.lines
        : attOp.lines === csOp.lines,
        'line count mismatch when composing changesets A*B; ' +
        `opA: ${attOp.toString()} opB: ${csOp.toString()}`);
    assert(['+', '='].includes(attOp.opcode), `unexpected opcode in op: ${attOp.toString()}`);
    assert(['-', '='].includes(csOp.opcode), `unexpected opcode in op: ${csOp.toString()}`);
    opOut.opcode = {
      '+': {
        '-': '', // The '-' cancels out (some of) the '+', leaving any remainder for the next call.
        '=': '+',
      },
      '=': {
        '-': '-',
        '=': '=',
      },
    }[attOp.opcode][csOp.opcode];
    const [fullyConsumedOp, partiallyConsumedOp] = [attOp, csOp].sort((a, b) => a.chars - b.chars);
    opOut.chars = fullyConsumedOp.chars;
    opOut.lines = fullyConsumedOp.lines;
    opOut.attribs = csOp.opcode === '-'
      // csOp is a remove op and remove ops should never have any attributes, so this should always
      // be the empty string. However, padDiff.js supposedly needs the attributes preserved if they
      // do happen to exist, so copy them just in case.
      ? csOp.attribs
      : exports.composeAttributes(attOp.attribs, csOp.attribs, attOp.opcode === '=', pool);
    partiallyConsumedOp.chars -= fullyConsumedOp.chars;
    partiallyConsumedOp.lines -= fullyConsumedOp.lines;
    if (!partiallyConsumedOp.chars) partiallyConsumedOp.opcode = '';
    fullyConsumedOp.opcode = '';
  }
  return opOut;
};

/**
 * Applies a Changeset to the attribs string of a AText.
 *
 * @param {string} cs - Changeset
 * @param {string} astr - the attribs string of a AText
 * @param {AttributePool} pool - the attibutes pool
 * @returns {string}
 */
exports.applyToAttribution = (cs, astr, pool) => {
  const unpacked = exports.unpack(cs);
  return applyZip(astr, unpacked.ops, (op1, op2) => slicerZipperFunc(op1, op2, pool));
};

exports.mutateAttributionLines = (cs, lines, pool) => {
  const unpacked = exports.unpack(cs);
  const csIter = new exports.OpIter(unpacked.ops);
  const csBank = unpacked.charBank;
  let csBankIndex = 0;
  // treat the attribution lines as text lines, mutating a line at a time
  const mut = new TextLinesMutator(lines);

  let lineIter = null;

  const isNextMutOp = () => (lineIter && lineIter.hasNext()) || mut.hasMore();

  const nextMutOp = () => {
    if ((!(lineIter && lineIter.hasNext())) && mut.hasMore()) {
      const line = mut.removeLines(1);
      lineIter = new exports.OpIter(line);
    }
    if (!lineIter || !lineIter.hasNext()) return new exports.Op();
    return lineIter.next();
  };
  let lineAssem = null;

  const outputMutOp = (op) => {
    if (!lineAssem) {
      lineAssem = new MergingOpAssembler();
    }
    lineAssem.append(op);
    if (op.lines <= 0) return;
    assert(op.lines === 1, "Can't have op.lines of ", op.lines, ' in attribution lines');
    // ship it to the mut
    mut.insert(lineAssem.toString(), 1);
    lineAssem = null;
  };

  let csOp = new exports.Op();
  let attOp = new exports.Op();
  while (csOp.opcode || csIter.hasNext() || attOp.opcode || isNextMutOp()) {
    if (!csOp.opcode && csIter.hasNext()) csOp = csIter.next();
    if ((!csOp.opcode) && (!attOp.opcode) && (!lineAssem) && (!(lineIter && lineIter.hasNext()))) {
      break; // done
    } else if (csOp.opcode === '=' && csOp.lines > 0 && (!csOp.attribs) &&
        (!attOp.opcode) && (!lineAssem) && (!(lineIter && lineIter.hasNext()))) {
      // skip multiple lines; this is what makes small changes not order of the document size
      mut.skipLines(csOp.lines);
      csOp.opcode = '';
    } else if (csOp.opcode === '+') {
      const opOut = copyOp(csOp);
      if (csOp.lines > 1) {
        const firstLineLen = csBank.indexOf('\n', csBankIndex) + 1 - csBankIndex;
        csOp.chars -= firstLineLen;
        csOp.lines--;
        opOut.lines = 1;
        opOut.chars = firstLineLen;
      } else {
        csOp.opcode = '';
      }
      outputMutOp(opOut);
      csBankIndex += opOut.chars;
    } else {
      if (!attOp.opcode && isNextMutOp()) attOp = nextMutOp();
      const opOut = slicerZipperFunc(attOp, csOp, pool);
      if (opOut.opcode) outputMutOp(opOut);
    }
  }

  assert(!lineAssem, `line assembler not finished:${cs}`);
  mut.close();
};

/**
 * Joins several Attribution lines.
 *
 * @param {string[]} theAlines - collection of Attribution lines
 * @returns {string} joined Attribution lines
 */
exports.joinAttributionLines = (theAlines) => {
  const assem = new MergingOpAssembler();
  for (let i = 0; i < theAlines.length; i++) {
    const aline = theAlines[i];
    for (const op of new exports.OpIter(aline)) assem.append(op);
  }
  return assem.toString();
};

exports.splitAttributionLines = (attrOps, text) => {
  const assem = new MergingOpAssembler();
  const lines = [];
  let pos = 0;

  const appendOp = (op) => {
    assem.append(op);
    if (op.lines > 0) {
      lines.push(assem.toString());
      assem.clear();
    }
    pos += op.chars;
  };

  for (const op of new exports.OpIter(attrOps)) {
    let numChars = op.chars;
    let numLines = op.lines;
    while (numLines > 1) {
      const newlineEnd = text.indexOf('\n', pos) + 1;
      assert(newlineEnd > 0, 'newlineEnd <= 0 in splitAttributionLines');
      op.chars = newlineEnd - pos;
      op.lines = 1;
      appendOp(op);
      numChars -= op.chars;
      numLines -= op.lines;
    }
    if (numLines === 1) {
      op.chars = numChars;
      op.lines = 1;
    }
    appendOp(op);
  }

  return lines;
};

/**
 * Splits text into lines.
 *
 * @param {string} text - text to split
 * @returns {string[]}
 */
exports.splitTextLines = (text) => text.match(/[^\n]*(?:\n|[^\n]$)/g);

/**
 * Compose two Changesets.
 *
 * @param {string} cs1 - first Changeset
 * @param {string} cs2 - second Changeset
 * @param {AttributePool} pool - Attribs pool
 * @returns {string}
 */
exports.compose = (cs1, cs2, pool) => {
  const unpacked1 = exports.unpack(cs1);
  const unpacked2 = exports.unpack(cs2);
  const len1 = unpacked1.oldLen;
  const len2 = unpacked1.newLen;
  assert(len2 === unpacked2.oldLen, 'mismatched composition of two changesets');
  const len3 = unpacked2.newLen;
  const bankIter1 = exports.stringIterator(unpacked1.charBank);
  const bankIter2 = exports.stringIterator(unpacked2.charBank);
  const bankAssem = exports.stringAssembler();

  const newOps = applyZip(unpacked1.ops, unpacked2.ops, (op1, op2) => {
    const op1code = op1.opcode;
    const op2code = op2.opcode;
    if (op1code === '+' && op2code === '-') {
      bankIter1.skip(Math.min(op1.chars, op2.chars));
    }
    const opOut = slicerZipperFunc(op1, op2, pool);
    if (opOut.opcode === '+') {
      if (op2code === '+') {
        bankAssem.append(bankIter2.take(opOut.chars));
      } else {
        bankAssem.append(bankIter1.take(opOut.chars));
      }
    }
    return opOut;
  });

  return exports.pack(len1, len3, newOps, bankAssem.toString());
};

/**
 * Returns a function that tests if a string of attributes (e.g. '*3*4') contains a given attribute
 * key,value that is already present in the pool.
 *
 * @param {Array<[string,string]>} attribPair - Array of attribute pairs.
 * @param {AttributePool} pool - Attribute pool
 * @returns {Function}
 */
exports.attributeTester = (attribPair, pool) => {
  const never = (attribs) => false;
  if (!pool) return never;
  const attribNum = pool.putAttrib(attribPair, true);
  if (attribNum < 0) return never;
  const re = new RegExp(`\\*${exports.numToString(attribNum)}(?!\\w)`);
  return (attribs) => re.test(attribs);
};

/**
 * Creates the identity Changeset of length N.
 *
 * @param {number} N - length of the identity changeset
 * @returns {string}
 */
exports.identity = (N) => exports.pack(N, N, '', '');

/**
 * Creates a Changeset which works on oldFullText and removes text from spliceStart to
 * spliceStart+numRemoved and inserts newText instead. Also gives possibility to add attributes
 * optNewTextAPairs for the new text.
 *
 * @param {string} oldFullText - old text
 * @param {number} spliceStart - where splicing starts
 * @param {number} numRemoved - number of characters to remove
 * @param {string} newText - string to insert
 * @param {string} optNewTextAPairs - new pairs to insert
 * @param {AttributePool} pool - Attribute pool
 * @returns {string}
 */
exports.makeSplice = (oldFullText, spliceStart, numRemoved, newText, optNewTextAPairs, pool) => {
  const oldLen = oldFullText.length;

  if (spliceStart >= oldLen) {
    spliceStart = oldLen - 1;
  }
  if (numRemoved > oldFullText.length - spliceStart) {
    numRemoved = oldFullText.length - spliceStart;
  }
  const oldText = oldFullText.substring(spliceStart, spliceStart + numRemoved);
  const newLen = oldLen + newText.length - oldText.length;

  const assem = new SmartOpAssembler();
  assem.appendOpWithText('=', oldFullText.substring(0, spliceStart));
  assem.appendOpWithText('-', oldText);
  assem.appendOpWithText('+', newText, optNewTextAPairs, pool);
  assem.endDocument();
  return exports.pack(oldLen, newLen, assem.toString(), newText);
};

/**
 * Transforms a changeset into a list of splices in the form [startChar, endChar, newText] meaning
 * replace text from startChar to endChar with newText.
 *
 * @param {string} cs - Changeset
 * @returns {Array<[number,number,string]>}
 */
const toSplices = (cs) => {
  const unpacked = exports.unpack(cs);
  const splices = [];

  let oldPos = 0;
  const charIter = exports.stringIterator(unpacked.charBank);
  let inSplice = false;
  for (const op of new exports.OpIter(unpacked.ops)) {
    if (op.opcode === '=') {
      oldPos += op.chars;
      inSplice = false;
    } else {
      if (!inSplice) {
        splices.push([oldPos, oldPos, '']);
        inSplice = true;
      }
      if (op.opcode === '-') {
        oldPos += op.chars;
        splices[splices.length - 1][1] += op.chars;
      } else if (op.opcode === '+') {
        splices[splices.length - 1][2] += charIter.take(op.chars);
      }
    }
  }

  return splices;
};

/**
 * @param {string} cs -
 * @param {number} startChar -
 * @param {number} endChar -
 * @param {number} insertionsAfter -
 * @returns {Array<[number,number]>}
 */
exports.characterRangeFollow = (cs, startChar, endChar, insertionsAfter) => {
  let newStartChar = startChar;
  let newEndChar = endChar;
  const splices = toSplices(cs);
  let lengthChangeSoFar = 0;
  for (let i = 0; i < splices.length; i++) {
    const splice = splices[i];
    const spliceStart = splice[0] + lengthChangeSoFar;
    const spliceEnd = splice[1] + lengthChangeSoFar;
    const newTextLength = splice[2].length;
    const thisLengthChange = newTextLength - (spliceEnd - spliceStart);

    if (spliceStart <= newStartChar && spliceEnd >= newEndChar) {
      // splice fully replaces/deletes range
      // (also case that handles insertion at a collapsed selection)
      if (insertionsAfter) {
        newStartChar = newEndChar = spliceStart;
      } else {
        newStartChar = newEndChar = spliceStart + newTextLength;
      }
    } else if (spliceEnd <= newStartChar) {
      // splice is before range
      newStartChar += thisLengthChange;
      newEndChar += thisLengthChange;
    } else if (spliceStart >= newEndChar) {
      // splice is after range
    } else if (spliceStart >= newStartChar && spliceEnd <= newEndChar) {
      // splice is inside range
      newEndChar += thisLengthChange;
    } else if (spliceEnd < newEndChar) {
      // splice overlaps beginning of range
      newStartChar = spliceStart + newTextLength;
      newEndChar += thisLengthChange;
    } else {
      // splice overlaps end of range
      newEndChar = spliceStart;
    }

    lengthChangeSoFar += thisLengthChange;
  }

  return [newStartChar, newEndChar];
};

/**
 * Iterate over attributes in a changeset and move them from oldPool to newPool.
 *
 * @param {string} cs - Chageset/attribution string to iterate over
 * @param {AttributePool} oldPool - old attributes pool
 * @param {AttributePool} newPool - new attributes pool
 * @returns {string} the new Changeset
 */
exports.moveOpsToNewPool = (cs, oldPool, newPool) => {
  // works on exports or attribution string
  let dollarPos = cs.indexOf('$');
  if (dollarPos < 0) {
    dollarPos = cs.length;
  }
  const upToDollar = cs.substring(0, dollarPos);
  const fromDollar = cs.substring(dollarPos);
  // order of attribs stays the same
  return upToDollar.replace(/\*([0-9a-z]+)/g, (_, a) => {
    const oldNum = exports.parseNum(a);
    let pair = oldPool.getAttrib(oldNum);

    /*
     * Setting an empty pair. Required for when delete pad contents / attributes
     * while another user has the timeslider open.
     *
     * Fixes https://github.com/ether/etherpad-lite/issues/3932
     */
    if (!pair) {
      pair = [];
    }

    const newNum = newPool.putAttrib(pair);
    return `*${exports.numToString(newNum)}`;
  }) + fromDollar;
};

/**
 * Create an attribution inserting a text.
 *
 * @param {string} text - text to insert
 * @returns {string}
 */
exports.makeAttribution = (text) => {
  const assem = new SmartOpAssembler();
  assem.appendOpWithText('+', text);
  return assem.toString();
};

/**
 * Iterates over attributes in exports, attribution string, or attribs property of an op and runs
 * function func on them.
 *
 * @param {string} cs - changeset
 * @param {Function} func - function to call
 */
exports.eachAttribNumber = (cs, func) => {
  let dollarPos = cs.indexOf('$');
  if (dollarPos < 0) {
    dollarPos = cs.length;
  }
  const upToDollar = cs.substring(0, dollarPos);

  upToDollar.replace(/\*([0-9a-z]+)/g, (_, a) => {
    func(exports.parseNum(a));
    return '';
  });
};

/**
 * Filter attributes which should remain in a Changeset. Callable on a exports, attribution string,
 * or attribs property of an op, though it may easily create adjacent ops that can be merged.
 *
 * @param {string} cs - changeset to filter
 * @param {Function} filter - fnc which returns true if an attribute X (int) should be kept in the
 *     Changeset
 * @returns {string}
 */
exports.filterAttribNumbers = (cs, filter) => exports.mapAttribNumbers(cs, filter);

/**
 * Does exactly the same as exports.filterAttribNumbers.
 *
 * @param {string} cs -
 * @param {Function} func -
 * @returns {string}
 */
exports.mapAttribNumbers = (cs, func) => {
  let dollarPos = cs.indexOf('$');
  if (dollarPos < 0) {
    dollarPos = cs.length;
  }
  const upToDollar = cs.substring(0, dollarPos);

  const newUpToDollar = upToDollar.replace(/\*([0-9a-z]+)/g, (s, a) => {
    const n = func(exports.parseNum(a));
    if (n === true) {
      return s;
    } else if ((typeof n) === 'number') {
      return `*${exports.numToString(n)}`;
    } else {
      return '';
    }
  });

  return newUpToDollar + cs.substring(dollarPos);
};

/**
 * @typedef {object} AText
 * @property {string} attribs -
 * @property {string} text -
 */

/**
 * Create a Changeset going from Identity to a certain state.
 *
 * @param {string} text - text of the final change
 * @param {string} attribs - optional, operations which insert the text and also puts the right
 *     attributes
 * @returns {AText}
 */
exports.makeAText = (text, attribs) => ({
  text,
  attribs: (attribs || exports.makeAttribution(text)),
});

/**
 * Apply a Changeset to a AText.
 *
 * @param {string} cs - Changeset to apply
 * @param {AText} atext -
 * @param {AttributePool} pool - Attribute Pool to add to
 * @returns {AText}
 */
exports.applyToAText = (cs, atext, pool) => ({
  text: exports.applyToText(cs, atext.text),
  attribs: exports.applyToAttribution(cs, atext.attribs, pool),
});

/**
 * Clones a AText structure.
 *
 * @param {AText} atext -
 * @returns {AText}
 */
exports.cloneAText = (atext) => {
  if (!atext) error('atext is null');
  return {
    text: atext.text,
    attribs: atext.attribs,
  };
};

/**
 * Copies a AText structure from atext1 to atext2.
 *
 * @param {AText} atext1 -
 * @param {AText} atext2 -
 */
exports.copyAText = (atext1, atext2) => {
  atext2.text = atext1.text;
  atext2.attribs = atext1.attribs;
};

/**
 * Append the set of operations from atext to an assembler.
 *
 * @param {AText} atext -
 * @param assem - Assembler like SmartOpAssembler TODO add desc
 */
exports.appendATextToAssembler = (atext, assem) => {
  // intentionally skips last newline char of atext
  let lastOp = null;
  for (const op of new exports.OpIter(atext.attribs)) {
    if (lastOp != null) assem.append(lastOp);
    lastOp = op;
  }
  if (lastOp == null) return;
  // exclude final newline
  if (lastOp.lines <= 1) {
    lastOp.lines = 0;
    lastOp.chars--;
  } else {
    const nextToLastNewlineEnd = atext.text.lastIndexOf('\n', atext.text.length - 2) + 1;
    const lastLineLength = atext.text.length - nextToLastNewlineEnd - 1;
    lastOp.lines--;
    lastOp.chars -= (lastLineLength + 1);
    assem.append(lastOp);
    lastOp.lines = 0;
    lastOp.chars = lastLineLength;
  }
  if (lastOp.chars) assem.append(lastOp);
};

/**
 * Creates a clone of a Changeset and it's APool.
 *
 * @param {string} cs -
 * @param {AttributePool} pool -
 * @returns {{translated: string, pool: AttributePool}}
 */
exports.prepareForWire = (cs, pool) => {
  const newPool = new AttributePool();
  const newCs = exports.moveOpsToNewPool(cs, pool, newPool);
  return {
    translated: newCs,
    pool: newPool,
  };
};

/**
 * Checks if a changeset s the identity changeset.
 *
 * @param {string} cs -
 * @returns {boolean}
 */
exports.isIdentity = (cs) => {
  const unpacked = exports.unpack(cs);
  return unpacked.ops === '' && unpacked.oldLen === unpacked.newLen;
};

/**
 * Returns all the values of attributes with a certain key in an Op attribs string.
 *
 * @param {Op} op - Op
 * @param {string} key - string to search for
 * @param {AttributePool} pool - attribute pool
 * @returns {string}
 */
exports.opAttributeValue = (op, key, pool) => exports.attribsAttributeValue(op.attribs, key, pool);

/**
 * Returns all the values of attributes with a certain key in an attribs string.
 *
 * @param {string} attribs - Attribute string
 * @param {string} key - string to search for
 * @param {AttributePool} pool - attribute pool
 * @returns {string}
 */
exports.attribsAttributeValue = (attribs, key, pool) => {
  if (!attribs) return '';
  let value = '';
  exports.eachAttribNumber(attribs, (n) => {
    if (pool.getAttribKey(n) === key) {
      value = pool.getAttribValue(n);
    }
  });
  return value;
};

/**
 * Incrementally builds a Changeset.
 *
 * @typedef {object} Builder
 * @property {Function} insert -
 * @property {Function} keep -
 * @property {Function} keepText -
 * @property {Function} remove -
 * @property {Function} toString -
 */

/**
 * @param {number} oldLen - Old length
 * @returns {Builder}
 */
exports.builder = (oldLen) => {
  const assem = new SmartOpAssembler();
  const o = new exports.Op();
  const charBank = exports.stringAssembler();

  const self = {
    /**
     * @param attribs - Either [[key1,value1],[key2,value2],...] or '*0*1...' (no pool needed in
     *     latter case).
     */
    keep: (N, L, attribs, pool) => {
      o.opcode = '=';
      o.attribs = (attribs && exports.makeAttribsString('=', attribs, pool)) || '';
      o.chars = N;
      o.lines = (L || 0);
      assem.append(o);
      return self;
    },
    keepText: (text, attribs, pool) => {
      assem.appendOpWithText('=', text, attribs, pool);
      return self;
    },
    insert: (text, attribs, pool) => {
      assem.appendOpWithText('+', text, attribs, pool);
      charBank.append(text);
      return self;
    },
    remove: (N, L) => {
      o.opcode = '-';
      o.attribs = '';
      o.chars = N;
      o.lines = (L || 0);
      assem.append(o);
      return self;
    },
    toString: () => {
      assem.endDocument();
      const newLen = oldLen + assem.getLengthChange();
      return exports.pack(oldLen, newLen, assem.toString(), charBank.toString());
    },
  };

  return self;
};

exports.makeAttribsString = (opcode, attribs, pool) => {
  // makeAttribsString(opcode, '*3') or makeAttribsString(opcode, [['foo','bar']], myPool) work
  if (!attribs) {
    return '';
  } else if ((typeof attribs) === 'string') {
    return attribs;
  } else if (pool && attribs.length) {
    if (attribs.length > 1) {
      attribs = attribs.slice();
      attribs.sort();
    }
    const result = [];
    for (let i = 0; i < attribs.length; i++) {
      const pair = attribs[i];
      if (opcode === '=' || (opcode === '+' && pair[1])) {
        result.push(`*${exports.numToString(pool.putAttrib(pair))}`);
      }
    }
    return result.join('');
  }
};

/**
 * Like "substring" but on a single-line attribution string.
 */
exports.subattribution = (astr, start, optEnd) => {
  const iter = new exports.OpIter(astr);
  const assem = new SmartOpAssembler();
  let attOp = new exports.Op();
  const csOp = new exports.Op();

  const doCsOp = () => {
    if (!csOp.chars) return;
    while (csOp.opcode && (attOp.opcode || iter.hasNext())) {
      if (!attOp.opcode) attOp = iter.next();
      if (csOp.opcode && attOp.opcode && csOp.chars >= attOp.chars &&
          attOp.lines > 0 && csOp.lines <= 0) {
        csOp.lines++;
      }
      const opOut = slicerZipperFunc(attOp, csOp, null);
      if (opOut.opcode) assem.append(opOut);
    }
  };

  csOp.opcode = '-';
  csOp.chars = start;

  doCsOp();

  if (optEnd === undefined) {
    if (attOp.opcode) {
      assem.append(attOp);
    }
    while (iter.hasNext()) assem.append(iter.next());
  } else {
    csOp.opcode = '=';
    csOp.chars = optEnd - start;
    doCsOp();
  }

  return assem.toString();
};

exports.inverse = (cs, lines, alines, pool) => {
  // lines and alines are what the exports is meant to apply to.
  // They may be arrays or objects with .get(i) and .length methods.
  // They include final newlines on lines.

  const linesGet = (idx) => {
    if (lines.get) {
      return lines.get(idx);
    } else {
      return lines[idx];
    }
  };

  /**
   * @param {number} idx -
   * @returns {string}
   */
  const alinesGet = (idx) => {
    if (alines.get) {
      return alines.get(idx);
    } else {
      return alines[idx];
    }
  };

  let curLine = 0;
  let curChar = 0;
  let curLineOpIter = null;
  let curLineOpIterLine;
  let curLineNextOp = new exports.Op('+');

  const unpacked = exports.unpack(cs);
  const builder = exports.builder(unpacked.newLen);

  const consumeAttribRuns = (numChars, func /* (len, attribs, endsLine)*/) => {
    if ((!curLineOpIter) || (curLineOpIterLine !== curLine)) {
      // create curLineOpIter and advance it to curChar
      curLineOpIter = new exports.OpIter(alinesGet(curLine));
      curLineOpIterLine = curLine;
      let indexIntoLine = 0;
      let done = false;
      while (!done && curLineOpIter.hasNext()) {
        curLineNextOp = curLineOpIter.next();
        if (indexIntoLine + curLineNextOp.chars >= curChar) {
          curLineNextOp.chars -= (curChar - indexIntoLine);
          done = true;
        } else {
          indexIntoLine += curLineNextOp.chars;
        }
      }
    }

    while (numChars > 0) {
      if ((!curLineNextOp.chars) && (!curLineOpIter.hasNext())) {
        curLine++;
        curChar = 0;
        curLineOpIterLine = curLine;
        curLineNextOp.chars = 0;
        curLineOpIter = new exports.OpIter(alinesGet(curLine));
      }
      if (!curLineNextOp.chars) curLineNextOp = curLineOpIter.next();
      const charsToUse = Math.min(numChars, curLineNextOp.chars);
      func(charsToUse, curLineNextOp.attribs, charsToUse === curLineNextOp.chars &&
          curLineNextOp.lines > 0);
      numChars -= charsToUse;
      curLineNextOp.chars -= charsToUse;
      curChar += charsToUse;
    }

    if ((!curLineNextOp.chars) && (!curLineOpIter.hasNext())) {
      curLine++;
      curChar = 0;
    }
  };

  const skip = (N, L) => {
    if (L) {
      curLine += L;
      curChar = 0;
    } else if (curLineOpIter && curLineOpIterLine === curLine) {
      consumeAttribRuns(N, () => {});
    } else {
      curChar += N;
    }
  };

  const nextText = (numChars) => {
    let len = 0;
    const assem = exports.stringAssembler();
    const firstString = linesGet(curLine).substring(curChar);
    len += firstString.length;
    assem.append(firstString);

    let lineNum = curLine + 1;
    while (len < numChars) {
      const nextString = linesGet(lineNum);
      len += nextString.length;
      assem.append(nextString);
      lineNum++;
    }

    return assem.toString().substring(0, numChars);
  };

  const cachedStrFunc = (func) => {
    const cache = {};
    return (s) => {
      if (!cache[s]) {
        cache[s] = func(s);
      }
      return cache[s];
    };
  };

  const attribKeys = [];
  const attribValues = [];
  for (const csOp of new exports.OpIter(unpacked.ops)) {
    if (csOp.opcode === '=') {
      if (csOp.attribs) {
        attribKeys.length = 0;
        attribValues.length = 0;
        exports.eachAttribNumber(csOp.attribs, (n) => {
          attribKeys.push(pool.getAttribKey(n));
          attribValues.push(pool.getAttribValue(n));
        });
        const undoBackToAttribs = cachedStrFunc((attribs) => {
          const backAttribs = [];
          for (let i = 0; i < attribKeys.length; i++) {
            const appliedKey = attribKeys[i];
            const appliedValue = attribValues[i];
            const oldValue = exports.attribsAttributeValue(attribs, appliedKey, pool);
            if (appliedValue !== oldValue) {
              backAttribs.push([appliedKey, oldValue]);
            }
          }
          return exports.makeAttribsString('=', backAttribs, pool);
        });
        consumeAttribRuns(csOp.chars, (len, attribs, endsLine) => {
          builder.keep(len, endsLine ? 1 : 0, undoBackToAttribs(attribs));
        });
      } else {
        skip(csOp.chars, csOp.lines);
        builder.keep(csOp.chars, csOp.lines);
      }
    } else if (csOp.opcode === '+') {
      builder.remove(csOp.chars, csOp.lines);
    } else if (csOp.opcode === '-') {
      const textBank = nextText(csOp.chars);
      let textBankIndex = 0;
      consumeAttribRuns(csOp.chars, (len, attribs, endsLine) => {
        builder.insert(textBank.substr(textBankIndex, len), attribs);
        textBankIndex += len;
      });
    }
  }

  return exports.checkRep(builder.toString());
};

// %CLIENT FILE ENDS HERE%
exports.follow = (cs1, cs2, reverseInsertOrder, pool) => {
  const unpacked1 = exports.unpack(cs1);
  const unpacked2 = exports.unpack(cs2);
  const len1 = unpacked1.oldLen;
  const len2 = unpacked2.oldLen;
  assert(len1 === len2, 'mismatched follow - cannot transform cs1 on top of cs2');
  const chars1 = exports.stringIterator(unpacked1.charBank);
  const chars2 = exports.stringIterator(unpacked2.charBank);

  const oldLen = unpacked1.newLen;
  let oldPos = 0;
  let newLen = 0;

  const hasInsertFirst = exports.attributeTester(['insertorder', 'first'], pool);

  const newOps = applyZip(unpacked1.ops, unpacked2.ops, (op1, op2) => {
    const opOut = new exports.Op();
    if (op1.opcode === '+' || op2.opcode === '+') {
      let whichToDo;
      if (op2.opcode !== '+') {
        whichToDo = 1;
      } else if (op1.opcode !== '+') {
        whichToDo = 2;
      } else {
        // both +
        const firstChar1 = chars1.peek(1);
        const firstChar2 = chars2.peek(1);
        const insertFirst1 = hasInsertFirst(op1.attribs);
        const insertFirst2 = hasInsertFirst(op2.attribs);
        if (insertFirst1 && !insertFirst2) {
          whichToDo = 1;
        } else if (insertFirst2 && !insertFirst1) {
          whichToDo = 2;
        } else if (firstChar1 === '\n' && firstChar2 !== '\n') {
          // insert string that doesn't start with a newline first so as not to break up lines
          whichToDo = 2;
        } else if (firstChar1 !== '\n' && firstChar2 === '\n') {
          whichToDo = 1;
        } else if (reverseInsertOrder) {
          // break symmetry:
          whichToDo = 2;
        } else {
          whichToDo = 1;
        }
      }
      if (whichToDo === 1) {
        chars1.skip(op1.chars);
        opOut.opcode = '=';
        opOut.lines = op1.lines;
        opOut.chars = op1.chars;
        opOut.attribs = '';
        op1.opcode = '';
      } else {
        // whichToDo == 2
        chars2.skip(op2.chars);
        copyOp(op2, opOut);
        op2.opcode = '';
      }
    } else if (op1.opcode === '-') {
      if (!op2.opcode) {
        op1.opcode = '';
      } else if (op1.chars <= op2.chars) {
        op2.chars -= op1.chars;
        op2.lines -= op1.lines;
        op1.opcode = '';
        if (!op2.chars) {
          op2.opcode = '';
        }
      } else {
        op1.chars -= op2.chars;
        op1.lines -= op2.lines;
        op2.opcode = '';
      }
    } else if (op2.opcode === '-') {
      copyOp(op2, opOut);
      if (!op1.opcode) {
        op2.opcode = '';
      } else if (op2.chars <= op1.chars) {
        // delete part or all of a keep
        op1.chars -= op2.chars;
        op1.lines -= op2.lines;
        op2.opcode = '';
        if (!op1.chars) {
          op1.opcode = '';
        }
      } else {
        // delete all of a keep, and keep going
        opOut.lines = op1.lines;
        opOut.chars = op1.chars;
        op2.lines -= op1.lines;
        op2.chars -= op1.chars;
        op1.opcode = '';
      }
    } else if (!op1.opcode) {
      copyOp(op2, opOut);
      op2.opcode = '';
    } else if (!op2.opcode) {
      // @NOTE: Critical bugfix for EPL issue #1625. We do not copy op1 here
      // in order to prevent attributes from leaking into result changesets.
      // copyOp(op1, opOut);
      op1.opcode = '';
    } else {
      // both keeps
      opOut.opcode = '=';
      opOut.attribs = followAttributes(op1.attribs, op2.attribs, pool);
      if (op1.chars <= op2.chars) {
        opOut.chars = op1.chars;
        opOut.lines = op1.lines;
        op2.chars -= op1.chars;
        op2.lines -= op1.lines;
        op1.opcode = '';
        if (!op2.chars) {
          op2.opcode = '';
        }
      } else {
        opOut.chars = op2.chars;
        opOut.lines = op2.lines;
        op1.chars -= op2.chars;
        op1.lines -= op2.lines;
        op2.opcode = '';
      }
    }
    switch (opOut.opcode) {
      case '=':
        oldPos += opOut.chars;
        newLen += opOut.chars;
        break;
      case '-':
        oldPos += opOut.chars;
        break;
      case '+':
        newLen += opOut.chars;
        break;
    }
    return opOut;
  });
  newLen += oldLen - oldPos;

  return exports.pack(oldLen, newLen, newOps, unpacked2.charBank);
};

const followAttributes = (att1, att2, pool) => {
  // The merge of two sets of attribute changes to the same text
  // takes the lexically-earlier value if there are two values
  // for the same key.  Otherwise, all key/value changes from
  // both attribute sets are taken.  This operation is the "follow",
  // so a set of changes is produced that can be applied to att1
  // to produce the merged set.
  if ((!att2) || (!pool)) return '';
  if (!att1) return att2;
  const atts = [];
  att2.replace(/\*([0-9a-z]+)/g, (_, a) => {
    atts.push(pool.getAttrib(exports.parseNum(a)));
    return '';
  });
  att1.replace(/\*([0-9a-z]+)/g, (_, a) => {
    const pair1 = pool.getAttrib(exports.parseNum(a));
    for (let i = 0; i < atts.length; i++) {
      const pair2 = atts[i];
      if (pair1[0] !== pair2[0]) continue;
      if (pair1[1] <= pair2[1]) {
        // winner of merge is pair1, delete this attribute
        atts.splice(i, 1);
      }
      break;
    }
    return '';
  });
  // we've only removed attributes, so they're already sorted
  const buf = exports.stringAssembler();
  for (let i = 0; i < atts.length; i++) {
    buf.append('*');
    buf.append(exports.numToString(pool.putAttrib(atts[i])));
  }
  return buf.toString();
};

exports.exportedForTestingOnly = {
  TextLinesMutator,
  followAttributes,
  toSplices,
};
