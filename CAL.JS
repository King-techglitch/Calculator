// Scientific calculator with functions and animated collapsible history
// Supports: sin, cos, tan, ln, log (base10), sqrt, pow (^), pow() function, parentheses, percent, +/- toggle, memory, history

// DOM
const displayEl = document.getElementById('display');
const subdisplayEl = document.getElementById('subdisplay');
const keys = document.querySelectorAll('.btn');
const historyList = document.getElementById('historyList');
const historyPanel = document.getElementById('historyPanel');
const toggleHistoryBtn = document.getElementById('toggleHistory');
const clearHistoryBtn = document.getElementById('clearHistory');
const memoryIndicator = document.getElementById('memoryIndicator');

// State
let expression = '';            // user-facing expression (uses × ÷ for display)
let lastWasEval = false;
let memory = loadMemory();
let history = loadHistory();

// Storage helpers
function saveMemory() { localStorage.setItem('calc_memory', String(memory)); }
function loadMemory() { const v = localStorage.getItem('calc_memory'); return v === null ? 0 : Number(v); }
function saveHistory() { localStorage.setItem('calc_history', JSON.stringify(history.slice(0, 200))); }
function loadHistory() { try { return JSON.parse(localStorage.getItem('calc_history') || '[]'); } catch { return []; } }

function formatDisplayForEval(expr) {
  return expr.replace(/×/g, '*').replace(/÷/g, '/');
}

function updateDisplay() {
  displayEl.textContent = expression === '' ? '0' : expression;
  subdisplayEl.textContent = lastWasEval ? '(result)' : '';
  memoryIndicator.textContent = memory !== 0 ? `M: ${memory}` : '';
}

function pushHistory(expr, result) {
  const entry = { expr, result, ts: Date.now() };
  history.unshift(entry);
  if (history.length > 200) history = history.slice(0, 200);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = '';
  history.forEach((h) => {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.title = new Date(h.ts).toLocaleString();
    li.textContent = `${h.expr} = ${h.result}`;
    li.addEventListener('click', () => {
      expression = String(h.result);
      lastWasEval = true;
      updateDisplay();
    });
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') li.click(); });
    historyList.appendChild(li);
  });
}

// Tokenizer and evaluator (shunting-yard + RPN) with function arg support and ^ operator
function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '(' || ch === ')' || ch === ',') { tokens.push(ch); i++; continue; }

    // operators: + - * / ^ 
    if (/[+\-*/^]/.test(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }

    // number (digits and dot)
    if (/\d|\./.test(ch)) {
      let num = '';
      let dotCount = 0;
      while (i < input.length && (/\d/.test(input[i]) || input[i] === '.')) {
        if (input[i] === '.') dotCount++;
        if (dotCount > 1) break;
        num += input[i++];
      }
      tokens.push(num);
      continue;
    }

    // functions / identifiers (letters)
    const match = input.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (match) {
      const name = match[0];
      tokens.push(name);
      i += name.length;
      continue;
    }

    // unknown char: skip
    i++;
  }
  return tokens;
}

const OPS = {
  '+': { prec: 2, assoc: 'L', args: 2, fn: (a,b)=>a+b },
  '-': { prec: 2, assoc: 'L', args: 2, fn: (a,b)=>a-b },
  '*': { prec: 3, assoc: 'L', args: 2, fn: (a,b)=>a*b },
  '/': { prec: 3, assoc: 'L', args: 2, fn: (a,b)=>a/b },
  '^': { prec: 4, assoc: 'R', args: 2, fn: (a,b)=>Math.pow(a,b) },
  'u-': { prec: 5, assoc: 'R', args: 1, fn: (a)=>-a }, // unary minus
};

const FUNCTIONS = {
  sqrt: { args: 1, fn: (a)=>{ if (a < 0) throw new Error('sqrt domain'); return Math.sqrt(a); } },
  sin: { args: 1, fn: (a)=>Math.sin(a) },
  cos: { args: 1, fn: (a)=>Math.cos(a) },
  tan: { args: 1, fn: (a)=>Math.tan(a) },
  ln: { args: 1, fn: (a)=>{ if (a <= 0) throw new Error('ln domain'); return Math.log(a); } }, // natural log
  log: { args: 1, fn: (a)=>{ if (a <= 0) throw new Error('log domain'); return Math.log10 ? Math.log10(a) : Math.log(a)/Math.LN10; } }, // base-10
  pow: { args: 2, fn: (a,b)=>Math.pow(a,b) }
};

// Convert tokens to RPN using shunting-yard
function toRPN(tokens) {
  const out = [];
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!isNaN(Number(t))) {
      out.push(t);
      continue;
    }
    if (t in FUNCTIONS) {
      stack.push(t);
      continue;
    }
    if (t === ',') {
      // function argument separator
      while (stack.length && stack[stack.length-1] !== '(') {
        out.push(stack.pop());
      }
      continue;
    }
    if (t in OPS || t === '+' || t === '-' || t === '*' || t === '/' || t === '^') {
      // Handle unary minus
      let op = t;
      if (t === '-') {
        const prev = tokens[i-1];
        if (i === 0 || prev === '(' || (prev in OPS) || (prev in FUNCTIONS) || prev === ',') {
          op = 'u-';
        }
      }
      const o1 = OPS[op];
      if (!o1) throw new Error('Unknown op ' + op);

      while (stack.length) {
        const top = stack[stack.length-1];
        if (top in OPS) {
          const o2 = OPS[top];
          if ((o1.assoc === 'L' && o1.prec <= o2.prec) || (o1.assoc === 'R' && o1.prec < o2.prec)) {
            out.push(stack.pop());
            continue;
          }
        }
        break;
      }
      stack.push(op);
      continue;
    }
    if (t === '(') {
      stack.push(t);
      continue;
    }
    if (t === ')') {
      while (stack.length && stack[stack.length-1] !== '(') {
        out.push(stack.pop());
      }
      if (!stack.length) throw new Error('Mismatched parentheses');
      stack.pop(); // pop '('
      if (stack.length && (stack[stack.length-1] in FUNCTIONS)) {
        out.push(stack.pop());
      }
      continue;
    }
    // Unknown token
    throw new Error('Unknown token ' + t);
  }
  while (stack.length) {
    const t = stack.pop();
    if (t === '(' || t === ')') throw new Error('Mismatched parentheses');
    out.push(t);
  }
  return out;
}

// Evaluate RPN
function evalRPN(rpn) {
  const st = [];
  for (const t of rpn) {
    if (!isNaN(Number(t))) {
      st.push(Number(t));
      continue;
    }
    if (t in OPS) {
      const info = OPS[t];
      if (info.args === 1) {
        if (st.length < 1) throw new Error('Insufficient values');
        const a = st.pop();
        st.push(info.fn(a));
      } else {
        if (st.length < 2) throw new Error('Insufficient values');
        const b = st.pop();
        const a = st.pop();
        if (t === '/' && b === 0) throw new Error('Division by zero');
        st.push(info.fn(a,b));
      }
      continue;
    }
    if (t in FUNCTIONS) {
      const info = FUNCTIONS[t];
      const n = info.args;
      if (st.length < n) throw new Error('Insufficient values for function ' + t);
      const args = [];
      for (let k = 0; k < n; k++) args.unshift(st.pop());
      st.push(info.fn(...args));
      continue;
    }
    throw new Error('Invalid RPN token ' + t);
  }
  if (st.length !== 1) throw new Error('Invalid expression');
  return st[0];
}

function evaluateSafe(exprDisplay) {
  if (!exprDisplay) return null;
  // Convert display to eval format
  let normalized = formatDisplayForEval(exprDisplay);
  // Replace function symbol(s) for sqrt if user used "√"
  normalized = normalized.replace(/√/g, 'sqrt');

  // Convert percent: number% -> (number/100), and (...)% -> (...)/100
  normalized = normalized.replace(/([0-9]+(\.[0-9]+)?)%/g, '($1/100)');
  normalized = normalized.replace(/\)\%/g, ')/100');

  // Ensure '^' stays as '^' (handled by OPS)
  const tokens = tokenize(normalized);
  const rpn = toRPN(tokens);
  const result = evalRPN(rpn);
  return result;
}

// Input handling
function appendChar(ch) {
  if (lastWasEval && /[0-9.(]/.test(ch)) {
    expression = ch === '.' ? '0.' : ch;
    lastWasEval = false;
    updateDisplay();
    return;
  }
  if (ch === '.') {
    const parts = expression.split(/[\+\-\×\÷\*\/\^\(\)]/);
    const last = parts[parts.length - 1];
    if (last.includes('.')) return;
    if (last === '') expression += '0';
  }
  if (ch === '*' || ch === '/') {
    ch = ch === '*' ? '×' : '÷';
  }
  // Prevent two operators in a row (allow negative start)
  const lastChar = expression.slice(-1);
  if (/[+\-×÷\^]/.test(ch)) {
    if (expression === '' && ch === '-') {
      expression = '-';
      updateDisplay();
      return;
    }
    if (/[+\-×÷\^]/.test(lastChar)) {
      expression = expression.slice(0, -1) + ch;
      updateDisplay();
      return;
    }
  }

  expression += ch;
  lastWasEval = false;
  updateDisplay();
}

function appendFunction(funcName) {
  // If user clicks function button, append functionName( (except for '^')
  if (funcName === '^') {
    // power operator
    appendChar('^');
    return;
  }
  // append like sin( or pow( for multi-arg pow
  expression += funcName + '(';
  lastWasEval = false;
  updateDisplay();
}

function applyClear() {
  expression = '';
  lastWasEval = false;
  updateDisplay();
}

function applyDelete() {
  if (lastWasEval) {
    applyClear();
    return;
  }
  expression = expression.slice(0, -1);
  updateDisplay();
}

function applyToggleSign() {
  if (expression === '') {
    expression = '-';
    updateDisplay();
    return;
  }
  // find last numeric segment
  const parts = expression.split(/([+\-×÷\*\/\^\(\)])/).filter(p=>p!=='');
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/^[0-9.]+$/.test(p)) {
      const neg = p.startsWith('-') ? p.slice(1) : '-' + p;
      const idx = expression.lastIndexOf(p);
      expression = expression.slice(0, idx) + neg + expression.slice(idx + p.length);
      updateDisplay();
      return;
    } else if (p === ')') {
      // wrap the parenthesis with (0- ( ... ))
      let depth = 0;
      for (let j = expression.length - 1; j >= 0; j--) {
        if (expression[j] === ')') depth++;
        else if (expression[j] === '(') {
          depth--;
          if (depth === 0) {
            const inner = expression.slice(j);
            expression = expression.slice(0, j) + '(0-' + inner + ')';
            updateDisplay();
            return;
          }
        }
      }
    } else if (/^[+\-×÷\*\/\^]$/.test(p)) {
      expression += '-';
      updateDisplay();
      return;
    }
  }
  expression = '-' + expression;
  updateDisplay();
}

function applyPercent() {
  if (expression === '') return;
  if (/\d$/.test(expression)) {
    let i = expression.length - 1;
    while (i >= 0 && /[0-9.]/.test(expression[i])) i--;
    const num = expression.slice(i + 1);
    expression = expression.slice(0, i + 1) + '(' + num + '/100)';
    updateDisplay();
    return;
  } else if (expression.slice(-1) === ')') {
    // find matching '('
    let depth = 0;
    let i = expression.length - 1;
    for (; i >= 0; i--) {
      if (expression[i] === ')') depth++;
      else if (expression[i] === '(') {
        depth--;
        if (depth === 0) break;
      }
    }
    const segment = expression.slice(i);
    expression = expression.slice(0, i) + '(' + segment + '/100)';
    updateDisplay();
    return;
  }
}

function applyEvaluate() {
  if (expression === '') return;
  try {
    const result = evaluateSafe(expression);
    if (typeof result !== 'number' || !isFinite(result)) throw new Error('Invalid result');
    pushHistory(expression, result);
    expression = String(result);
    lastWasEval = true;
    updateDisplay();
  } catch (err) {
    displayEl.textContent = 'Error';
    lastWasEval = true;
    setTimeout(() => {
      expression = '';
      lastWasEval = false;
      updateDisplay();
    }, 900);
  }
}

// Memory functions
function memClear() { memory = 0; saveMemory(); updateDisplay(); }
function memRecall() { expression = String(memory); lastWasEval = true; updateDisplay(); }
function memAdd() {
  const current = Number(displayEl.textContent) || 0;
  memory = memory + current;
  saveMemory(); updateDisplay();
}
function memMinus() {
  const current = Number(displayEl.textContent) || 0;
  memory = memory - current;
  saveMemory(); updateDisplay();
}

// Button wiring
keys.forEach(key => {
  key.addEventListener('click', () => {
    const action = key.dataset.action;
    const val = key.dataset.value;
    const funcName = key.dataset.func;

    if (action === 'clear') return applyClear();
    if (action === 'delete') return applyDelete();
    if (action === 'evaluate') return applyEvaluate();
    if (action === 'toggleSign') return applyToggleSign();
    if (action === 'percent') return applyPercent();
    if (action === 'paren') { appendChar(val); return; }
    if (action === 'mc') { memClear(); return; }
    if (action === 'mr') { memRecall(); return; }
    if (action === 'mplus') { memAdd(); return; }
    if (action === 'mminus') { memMinus(); return; }

    if (funcName) {
      appendFunction(funcName);
      return;
    }

    if (val) {
      appendChar(val);
    }
  });
});

// Keyboard support
window.addEventListener('keydown', (e) => {
  const key = e.key;

  if ((key >= '0' && key <= '9') || key === '.') {
    appendChar(key);
    return;
  }
  if (key === '+' || key === '-' || key === '*' || key === '/') {
    const map = {'*':'×','/':'÷'};
    appendChar(map[key] || key);
    return;
  }
  if (key === '^') {
    appendChar('^');
    return;
  }
  if (key === '(' || key === ')') {
    appendChar(key);
    return;
  }
  if (key === 'Enter' || key === '=') {
    e.preventDefault();
    applyEvaluate();
    return;
  }
  if (key === 'Backspace') {
    applyDelete();
    return;
  }
  if (key === 'Escape') {
    applyClear();
    return;
  }
  // function shortcuts (convenience)
  if (key === 's') { appendFunction('sin'); return; }   // s -> sin(
  if (key === 'c') { appendFunction('cos'); return; }   // c -> cos(
  if (key === 't') { appendFunction('tan'); return; }   // t -> tan(
  if (key === 'l') { appendFunction('ln'); return; }    // l -> ln(
  if (key === 'L') { appendFunction('log'); return; }   // Shift+l -> log(
  if (key === 'p') { appendFunction('pow'); return; }   // p -> pow(
  if (key === '%') { applyPercent(); return; }
});

// History panel controls (collapsible with animation)
function toggleHistory() {
  const isCollapsed = historyPanel.classList.toggle('collapsed');
  toggleHistoryBtn.textContent = isCollapsed ? 'Show' : 'Hide';
}
toggleHistoryBtn.addEventListener('click', toggleHistory);
clearHistoryBtn.addEventListener('click', () => {
  if (!confirm('Clear calculation history?')) return;
  history = [];
  saveHistory();
  renderHistory();
});

// Initial render
updateDisplay();
renderHistory();
saveMemory();
saveHistory();