(function() {
    // ============================================================
    // DOM
    // ============================================================
    const screenEl    = document.getElementById('screen');
    const hiddenInput = document.getElementById('cmdInput');
    const typedText   = document.getElementById('typedText');
    const inputVisible= document.getElementById('inputVisible');
    const inputRow    = document.getElementById('inputRow');
    const terminalEl  = document.getElementById('terminal');
    const hintEl      = document.getElementById('hint');

    function escapeHtml(str) {
      const d = document.createElement('div');
      d.innerText = str;
      return d.innerHTML;
    }

    // ----- renderPanel -----
    function renderPanel(rows) {
      const out = [];
      for (const row of rows) {
        if (row == null) continue;

        if (row.blank) {
          out.push('<div class="row"><span class="value">\u00A0</span></div>');
          continue;
        }

        if (row.divider) {
          out.push(`<div class="row section-divider">${escapeHtml(row.divider)}</div>`);
          continue;
        }

        if (row.text !== undefined) {
          out.push(`<div class="row"><span class="value">${row.text}</span></div>`);
          continue;
        }

        // labelled row
        const { label = '', value = '' } = row;

        // --- render label (link or plain text) ---
        let labelHtml;
        if (label && typeof label === 'object' && label.href) {
          labelHtml = `<a href="${escapeHtml(label.href)}" target="_blank" rel="noopener" class="no-decor">${escapeHtml(label.text)}</a>`;
        } else {
          labelHtml = escapeHtml(String(label));
        }

        // --- render value ---
        let valueHtml;
        if (value && typeof value === 'object' && value.html !== undefined) {
          valueHtml = value.html;
        } else if (value && typeof value === 'object' && value.text !== undefined) {
          valueHtml = value.href
            ? `<a href="${escapeHtml(value.href)}" target="_blank" rel="noopener" class="no-decor">${escapeHtml(value.text)}</a>`
            : escapeHtml(value.text);
        } else {
          valueHtml = escapeHtml(String(value));
        }

        out.push(
          `<div class="row">` +
            `<span class="label">${labelHtml}</span>` +
            `<span class="value">${valueHtml}</span>` +
          `</div>`
        );
      }
      return `<div class="panel">${out.join('')}</div>`;
    }
    // ============================================================
    // ECHO
    // ============================================================
    // Emulates the useful ~80% of bash's `echo` builtin.
    const ECHO_VARS = {
      '?': '0',
      '0': 'zsh',
      '#': '0',
      '$': String(42000 + Math.floor(Math.random() * 1000)),
      USER: 'ribs351',
      HOME: '/home/ribs351',
      PWD: '/home/ribs351/portfolio',
      SHELL: '/bin/zsh',
      HOSTNAME: 'ribs351.github.io',
      TERM: 'xterm-256color',
    };

    function echoExpandVars(str) {
      // $VAR, ${VAR}, $?, $$, $0, $#
      return str.replace(
        /\$(\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*|[?#$0-9])/g,
        (_, name) => {
          if (name.startsWith('{')) name = name.slice(1, -1);
          return ECHO_VARS[name] !== undefined ? ECHO_VARS[name] : '';
        }
      );
    }

    function echoExpandTilde(str) {
      // only at the start of a word (start of string or after whitespace)
      return str.replace(/(^|\s)~(?=\/|$|\s)/g, (_, pre) => pre + ECHO_VARS.HOME);
    }

    function echoApplyEscapes(str) {
      // Returns { text, stop } where stop=true means \c was hit.
      let out = '';
      let i = 0;
      let stop = false;

      while (i < str.length) {
        const ch = str[i];
        if (ch !== '\\') { out += ch; i++; continue; }
        if (i + 1 >= str.length) { out += '\\'; break; }

        const next = str[i + 1];
        i += 2;

        switch (next) {
          case 'a': out += '\x07'; break;
          case 'b': out += '\b';   break;
          case 'c': stop = true;   break;
          case 'e': out += '\x1b'; break;
          case 'f': out += '\f';   break;
          case 'n': out += '\n';   break;
          case 'r': out += '\r';   break;
          case 't': out += '\t';   break;
          case 'v': out += '\v';   break;
          case '\\': out += '\\';  break;
          case 'x': {
            // \xHH — up to 2 hex digits
            const m = /^[0-9a-fA-F]{1,2}/.exec(str.slice(i));
            if (m) {
              out += String.fromCharCode(parseInt(m[0], 16));
              i += m[0].length;
            } else {
              out += '\\x';
            }
            break;
          }
          case '0': {
            // \0NNN — up to 3 octal digits (after the leading 0)
            const m = /^[0-7]{1,3}/.exec(str.slice(i));
            if (m) {
              out += String.fromCharCode(parseInt(m[0], 8));
              i += m[0].length;
            } else {
              out += '\0';
            }
            break;
          }
          default:
            // Unknown escape: real bash keeps the backslash
            out += '\\' + next;
        }

        if (stop) break;
      }

      return { text: out, stop };
    }

    function tokenizeEcho(input) {
      const tokens = [];
      let cur = '';
      let curQuote = '';    
      let tokenQuote = ''; 
      let hasContent = false;

      const push = () => {
        tokens.push({ raw: cur, quote: tokenQuote });
        cur = '';
        curQuote = '';
        tokenQuote = '';
        hasContent = false;
      };

      let i = 0;
      while (i < input.length) {
        const ch = input[i];

        if (curQuote === "'") {
          if (ch === "'") { curQuote = ''; i++; continue; }
          cur += ch; i++; continue;
        }

        if (curQuote === '"') {
          if (ch === '"') { curQuote = ''; i++; continue; }
          if (ch === '\\' && i + 1 < input.length) {
            const n = input[i + 1];
            if (n === '"' || n === '\\' || n === '$' || n === '`') {
              cur += n; i += 2; continue;
            }
            cur += ch; i++; continue;
          }
          cur += ch; i++; continue;
        }

        // unquoted
        if (ch === "'" || ch === '"') {
          if (!hasContent && cur.length === 0) {
            curQuote = ch;
            tokenQuote = ch; // Capture the starting quote type
          }
          hasContent = true;
          i++; continue;
        }
        if (ch === '\\' && i + 1 < input.length) {
          const n = input[i + 1];
          if (n === '\n') { i += 2; continue; }
          cur += n; i += 2; hasContent = true; continue;
        }
        if (/\s/.test(ch)) {
          if (hasContent || cur.length > 0) push();
          i++; continue;
        }
        cur += ch;
        hasContent = true;
        i++;
      }
      if (hasContent || cur.length > 0) push();
      return tokens;
    }

    function echoCommand(rawArgs) {
      const tokens = tokenizeEcho(rawArgs);

      let noNewline = false;
      let interpretEscapes = false;
      let i = 0;

      // parse flags
      while (i < tokens.length) {
        const t = tokens[i];
        if (t.quote) break;                 // quoted "-n" is literal
        if (t.raw === '--') { i++; break; } // end of options
        if (t.raw === '-') break;           // lone "-" is an argument
        if (!/^-[ne]+$/.test(t.raw)) break; // not a flag

        for (const c of t.raw.slice(1)) {
          if (c === 'n') noNewline = true;
          if (c === 'e') interpretEscapes = true;
        }
        i++;
      }

      // process remaining tokens
      const parts = [];
      let stop = false;

      for (; i < tokens.length && !stop; i++) {
        const t = tokens[i];
        let s = t.raw;

        if (t.quote === "'") {
          // single quotes: fully literal
        } else if (t.quote === '"') {
          s = echoExpandVars(s);
          s = echoExpandTilde(s);
          if (interpretEscapes) {
            const r = echoApplyEscapes(s);
            s = r.text;
            if (r.stop) stop = true;
          }
        } else {
          // unquoted
          s = echoExpandVars(s);
          s = echoExpandTilde(s);
          if (interpretEscapes) {
            const r = echoApplyEscapes(s);
            s = r.text;
            if (r.stop) stop = true;
          }
        }

        parts.push(s);
      }

      const joined = parts.join(' ');
      const text = stop ? joined : joined + (noNewline ? '' : '\n');

      // Print the text verbatim.
      const div = document.createElement('div');
      div.className = 'line output';
      div.style.whiteSpace = 'pre-wrap';
      div.textContent = text;
      screenEl.appendChild(div);
      return null;
    }
    // ============================================================
    // COMMANDS
    // ============================================================

    let sudoAttempts = 0;
    let terminalLocked = false;

    const sudoResponses = [
      'Permission denied: nice try.',
      'Permission denied: seriously?',
      'Permission denied: you already tried that.',
      'Permission denied: this is getting embarrassing.',
      'Permission denied: I admire your persistence. I do not respect it.',
      'Permission denied: sudo privileges are not going to manifest through sheer determination.',
      'Permission denied: stop typing sudo.',
      'Permission denied: STOP TYPING SUDO.',
      'Permission denied: okay, now you are just testing me.',
      'Permission denied: fine. The terminal needs a timeout.',
    ];

    const commands = {
      echo: (args) => echoCommand(args),
      help: () => renderPanel([
        { text: 'available commands:' },
        { blank: true },
        { label: 'whoami',  value: 'who am i, roughly' },
        { label: 'projects', value: "things i've built (or am building)" },
        { label: 'contact', value: 'ways to reach me' },
        { label: 'echo',    value: 'print things (mostly)' },
        { label: 'sudo',    value: "don't" },
        { label: 'clear',   value: 'clear the screen' },
        { label: 'help',    value: 'show this list again' },
      ]),
      sl: slCommand,
      whoami: () => renderPanel([
        { text: '<span class="ok">ribs351</span>' },
        { blank: true },
        { label: 'role',  value: 'senior procrastinator · backend dev · genuine coper' },
        { label: 'stack', value: 'C# / .NET 8' },
        { label: 'note',  value: "I build things that (usually) don't crash." },
        { blank: true },
        { text: `<span class="dim">type 'projects' to see what that means in practice.</span>` },
      ]),

      projects: () => renderPanel([
        { text: '<span class="dim"># TODO: fill more of these in, there\'s only 3 rn... </span>' },
        { blank: true },
        {
          label: { text: 'VictorNovember_2026', href: 'https://github.com/ribs351/VictorNovember_2026' },
          value: { html: '<span class="dim">Discord bot rewrite · Discord · .NET 8 · DSharpPlus</span>' },
        },

        {
          label: { text: 'CoH2: Defiance', href: 'https://github.com/Team-Defiance/Project-Defiance' },
          value: { html: '<span class="dim">Gameplay overhaul mod · Company of Heroes 2 · AttributeEditor</span>' },
        },

        {
          label: { text: 'KF2AutoGrenades', href: 'https://github.com/ribs351/KF2AutoGrenades' },
          value: { html: '<span class="dim">XP grind automation · Killing Floor 2 · OpenCvSharp · Tesseract OCR </span>' },
        },
      ]),

      contact: () => renderPanel([
        { label: 'github', value: { text: 'github.com/ribs351', href: 'https://github.com/ribs351' } },
        { label: 'other',  value: 'ribs351 on discord' },
      ]),

      sudo: () => {
      sudoAttempts++;

      const response =
        sudoResponses[Math.min(sudoAttempts - 1, sudoResponses.length - 1)];

      if (sudoAttempts === 5) {
        return renderPanel([
          { text: '<span class="warn">Permission denied.</span>' },
          { blank: true },
          { text: '<span class="dim">security has been notified.</span>' },
          { text: '<span class="dim">(security is one guy named Steve.)</span>' },
        ]);
      }

      if (sudoAttempts === 7) {
        return renderPanel([
          { text: '<span class="warn">Permission denied.</span>' },
          { blank: true },
          { text: '<span class="dim">sudo has been added to the watchlist.</span>' },
          { text: '<span class="dim">the watchlist is a text file.</span>' },
        ]);
      }

      if (sudoAttempts >= 10) {
        lockTerminal(3);
        return renderPanel([
          { text: '<span class="warn">Permission denied: absolutely not.</span>' },
          { blank: true },
          { text: '<span class="dim">terminal locked for 3 seconds.</span>' },
        ]);
      }

      return renderPanel([
        { text: `<span class="warn">${response}</span>` },
        { blank: true },
        {
          text: `<span class="dim">sudo attempts: ${sudoAttempts}</span>`
        },
      ]);
    },

      clear: () => {
        screenEl.innerHTML = '';
        return null;
      },
    };

    const aliases = {
      cls: 'clear',
      ls: 'projects',
      about: 'whoami',
    };

    function lockTerminal(seconds) {
      if (terminalLocked) return;

      terminalLocked = true;
      inputRow.classList.add('disabled');
      hiddenInput.blur();

      let remaining = seconds;

      const lockLine = printRaw(
        `<span class="warn">[LOCKED] terminal cooldown: ${remaining}s</span>`,
        'output'
      );

      const timer = setInterval(() => {
        remaining--;

        if (remaining <= 0) {
          clearInterval(timer);
          terminalLocked = false;
          inputRow.classList.remove('disabled');
          hiddenInput.focus();

          lockLine.innerHTML =
            '<span class="ok">[UNLOCKED] try behaving yourself.</span>';

          scrollToBottom();
          return;
        }

        lockLine.innerHTML =
          `<span class="warn">[LOCKED] terminal cooldown: ${remaining}s</span>`;

        scrollToBottom();
      }, 1000);
    }

    async function fakeNukeSequence() {
      const panicLines = [
        '<span class="warn">sudo: rm -rf /</span>',
        '<span class="warn">WARNING: recursive deletion of root filesystem requested</span>',
        '<span class="dim">checking whether this is a terrible idea...</span>',
        '<span class="warn">this is a terrible idea.</span>',
        '<span class="dim">mounting /dev/regret...</span>',
        '<span class="dim">formatting reality...</span>',
        '<span class="dim">deleting /etc...</span>',
        '<span class="dim">deleting /usr...</span>',
        '<span class="dim">deleting /home...</span>',
        '<span class="dim">deleting laws of physics...</span>',
        '<span class="warn">CRITICAL: reality filesystem integrity compromised</span>',
        '<span class="warn">████████████████████ 100%</span>',
        '<span class="dim">...</span>',
        '<span class="ok">just kidding.</span>',
        '<span class="ok">Permission denied: this isn\'t even a real shell.</span>',
      ];

      for (const line of panicLines) {
        printRaw(line, 'output');
        scrollToBottom();
        await new Promise(resolve => setTimeout(resolve, 350));
      }

      printRaw('', 'output');
    }
    // ============================================================
    // OUTPUT HELPERS
    // ============================================================
    function printRaw(html, cls) {
      const div = document.createElement('div');
      div.className = 'line ' + (cls || '');
      div.innerHTML = html;
      screenEl.appendChild(div);
      return div;
    }

    function scrollToBottom() {
      screenEl.scrollTop = screenEl.scrollHeight;
    }

    // ============================================================
    // FLICKER-IN
    // ============================================================
    function flickerIn(element, duration = 500, triggerRatio = 0.5, onTrigger) {
      return new Promise((resolve) => {
        const flickerCounts = [5, 7, 9];
        const count = flickerCounts[Math.floor(Math.random() * flickerCounts.length)];

        const times = [];
        for (let i = 0; i < count - 1; i++) times.push(Math.random() * duration);
        times.push(duration);
        times.sort((a, b) => a - b);

        let visible = false;
        let triggered = false;
        const triggerTime = duration * triggerRatio;

        element.style.opacity = '0';

        times.forEach((time, index) => {
          setTimeout(() => {
            if (!triggered && time >= triggerTime) {
              triggered = true;
              onTrigger?.();
            }
            visible = !visible;
            element.style.opacity = visible ? '1' : '0';
            if (index === times.length - 1) {
              element.style.opacity = '1';
              resolve();
            }
          }, time);
        });
      });
    }

    // ============================================================
    // BOOT SEQUENCE
    // ============================================================
    function bootSequence() {
      const steps = [
        { text: 'ribs351@github.io - v1.0', cls: 'boot-line' },
        { text: '─────────────────────────────────────────', cls: 'boot-line boot-tag' },
        { blank: true },

        { text: 'system clock synchronized', cls: 'boot-line', prefix: 'ok' },
        { text: 'memory check: 640K ought to be enough', cls: 'boot-line', prefix: 'ok' },
        { text: 'loading kernel modules...', cls: 'boot-line', prefix: 'ok' },
        { progress: 'mounting /dev/creativity' },
        { progress: 'initializing caffeine subsystem' },
        { progress: 'spinning up motivation daemon' },

        { text: 'motivation daemon is idling at 3%', cls: 'boot-line', prefix: 'warn' },
        { text: 'falling back to coffee-driven mode', cls: 'boot-line', prefix: 'ok' },
        { text: 'loading portfolio modules', cls: 'boot-line', prefix: 'ok' },
        { text: 'checking github.com/ribs351 ... reachable', cls: 'boot-line', prefix: 'ok' },
        { text: 'checking c# runtime ... .NET 8 present', cls: 'boot-line', prefix: 'ok' },
        { blank: true },
        { text: 'all systems nominal. handing off to shell.', cls: 'boot-line' },
        { blank: true },
      ];

      const LINE_DELAY         = 140;
      const PROGRESS_TICK_MS   = 55;
      const TOTAL_BARS         = 14;
      const GAP_AFTER_PROGRESS = 60;

      function buildStep(step) {
        if (step.blank) {
          const el = document.createElement('div');
          el.className = 'line boot-line';
          el.innerHTML = '\u00A0';
          return el;
        }
        if (step.progress !== undefined) {
          const line = document.createElement('div');
          line.className = 'boot-line boot-progress';

          const label = document.createElement('span');
          label.className = 'boot-progress-label';
          label.innerHTML = `<span class="boot-tag">[ .. ]</span> ${escapeHtml(step.progress)}`;

          const bar = document.createElement('span');
          bar.className = 'boot-progress-bar';

          line.appendChild(label);
          line.appendChild(bar);
          line._label = label;
          line._bar = bar;
          return line;
        }
        const prefixHtml = step.prefix === 'ok'
          ? '<span class="boot-status">[ OK ]</span> '
          : step.prefix === 'warn'
            ? '<span class="boot-warn">[ WARN ]</span> '
            : '';
        const text = step.prefix ? step.text.replace(/^\[[^\]]*\]\s*/, '') : step.text;

        const el = document.createElement('div');
        el.className = step.cls || 'boot-line';
        el.innerHTML = prefixHtml + escapeHtml(text);
        return el;
      }

      function animateProgress(el) {
        return new Promise((resolve) => {
          const bar = el._bar;
          const label = el._label;
          const labelText = label.innerHTML.replace(/^<span[^>]*>\[ .. \]<\/span>\s*/, '');
          let filled = 0;

          const tick = () => {
            filled++;
            bar.textContent = '█'.repeat(filled) + '░'.repeat(TOTAL_BARS - filled);
            scrollToBottom();
            if (filled < TOTAL_BARS) {
              setTimeout(tick, PROGRESS_TICK_MS);
            } else {
              label.innerHTML = `<span class="boot-status">[  OK  ]</span> ${labelText}`;
              setTimeout(resolve, GAP_AFTER_PROGRESS);
            }
          };
          setTimeout(tick, 30);
        });
      }

      return new Promise((resolveAll) => {
        let i = 0;
        function next() {
          if (i >= steps.length) { resolveAll(); return; }
          const step = steps[i++];
          const el = buildStep(step);
          screenEl.appendChild(el);
          scrollToBottom();

          if (step.progress !== undefined) {
            animateProgress(el).then(next);
            return;
          }
          setTimeout(next, LINE_DELAY);
        }
        setTimeout(next, 200);
      });
    }

    // ============================================================
    // INPUT HANDLING
    // ============================================================
    let currentInput = '';

    function syncView() { typedText.textContent = currentInput; }

    function clearInput() {
      currentInput = '';
      syncView();
      hiddenInput.value = '';
    }

    function onKeyDown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = currentInput;
        runCommand(cmd);
        clearInput();
        scrollToBottom();
        return;
      }
      const isWordDelete =
        (e.key === 'Backspace' && (e.ctrlKey || e.altKey || e.metaKey)) ||
        (e.key.toLowerCase() === 'w' && e.ctrlKey);

      if (isWordDelete) {
        e.preventDefault();
        currentInput = killWordBefore(currentInput);
        syncView();
        return;
      }

      // ---- plain backspace ----
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (currentInput.length > 0) {
          currentInput = currentInput.slice(0, -1);
          syncView();
        }
        return;
      }

      // ---- plain character input ----
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        currentInput += e.key;
        syncView();
      }
    }
    function killWordBefore(str) {
      let i = str.length;

      // strip trailing whitespace
      while (i > 0 && /\s/.test(str[i - 1])) i--;

      // strip the word itself
      while (i > 0 && !/\s/.test(str[i - 1])) i--;

      return str.slice(0, i);
    }
    function onHiddenInput() {
      if (hiddenInput.value !== currentInput) {
        currentInput = hiddenInput.value;
        syncView();
      }
    }

    function onPaste(e) {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text');
      if (pasted) {
        currentInput += pasted.replace(/[\r\n]+/g, ' ');
        syncView();
      }
    }

    // ============================================================
    // COMMAND RUNNER
    // ============================================================
    async function runCommand(raw) {
      if (terminalLocked) {
        printRaw(
          '<span class="warn">terminal is locked. wait.</span>',
          'output'
        );
        return;
      }

      const cmd = raw.trim();
      printRaw(`<span class="prompt-symbol">$</span> ${escapeHtml(cmd)}`, 'prompt-line');

      if (cmd === '') {
        printRaw('', 'output');
        return;
      }

      if (cmd.toLowerCase() === 'sudo rm -rf /') {
        await fakeNukeSequence();
        return;
      }

      const shellCommands = ['sudo -i', 'sudo su -'];

        if (shellCommands.includes(cmd.toLowerCase())) {
          sudoAttempts++;

          const messages = [
            "Nice try. This isn't even a real shell.",
            "You can't `su` into a shell that doesn't exist.",
            "There is no root account. There isn't even an account.",
            "You're trying to become root inside a website.",
            "I need you to understand what you're attempting here.",
            "This is HTML pretending to be a terminal.",
            "sudo: reality check failed.",
          ];

          const message =
            messages[Math.min(sudoAttempts - 1, messages.length - 1)];

          printRaw(`<span class="warn">${message}</span>`, 'output');
          printRaw(
            `<span class="dim">sudo attempts: ${sudoAttempts}</span>`,
            'output'
          );
          printRaw('', 'output');
          scrollToBottom();
          return;
        }

      const firstSpace = cmd.search(/\s/);
      const name = firstSpace === -1 ? cmd : cmd.slice(0, firstSpace);
      const argString = firstSpace === -1 ? '' : cmd.slice(firstSpace + 1);

      const lower = name.toLowerCase();
      const key = aliases[lower] || lower;
      const handler = commands[key];

      if (!handler) {
        printRaw(`command not found: ${escapeHtml(cmd)} — try 'help'`, 'output warn');
        printRaw('', 'output');
        return;
      }

      const result = handler(argString);
      if (result !== null && result !== undefined) {
        printRaw(result, 'output');
        printRaw('', 'output');
      }
    }
    // ============================================================
    // SL — steam locomotive (because you typed `ls` wrong)
    // ============================================================
    let slRunning = false;

    function slCommand() {
      if (slRunning) return null;
      slRunning = true;

      // Print the witty remark first so it sits above the train
      printRaw(
        '<span class="dim">you meant `ls`? ... launching anyway.</span>',
        'output'
      );

      const ART = [
        "       ====        ________                   ___________ ",
        "  _D _|  |_______/        \\__I_I_____===__|_________| ",
        "   |(_)---  |   H\\________/ |   |      =|___ ___|   ",
        "   /    |  |   H  |  |     |   |      ||_| |_||   ",
        "  |     |  |   H  |__--------------------| [___] |   ",
        "  | ________|___H__/[][]~\\_______|       |   ",
        "  |/ |  |-----------I_____I [][] []  D   |=======|__ ",
        "__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
        " |/-=|___|=    ||    ||    ||    |_____/~\\___/        ",
        "  \\_/     \\O=====O=====O=====O_/      \\_/            ",
      ];

      const WIDTH = Math.max(...ART.map(r => r.length));
      // Screen window width for the train to traverse across
      const SCREEN_WIDTH = 100; 
      const totalFrames = WIDTH + SCREEN_WIDTH;
      const FRAME_MS = 50;

      const container = document.createElement('div');
      container.className = 'line output';
      const pre = document.createElement('pre');
      pre.style.margin = '0';
      pre.style.font = 'inherit';
      pre.style.lineHeight = '1.15';
      pre.style.overflow = 'hidden';
      container.appendChild(pre);
      screenEl.appendChild(container);

      let frame = 0;

      function draw() {
        // As frame increases, the window moves across the padded space from right to left
        const lines = ART.map(row => {
          const padded = row.padEnd(WIDTH, ' ');
          const fullLine = ' '.repeat(SCREEN_WIDTH) + padded + ' '.repeat(SCREEN_WIDTH);
          // Slide the viewing window from right to left
          return fullLine.slice(frame, frame + SCREEN_WIDTH);
        });
        pre.textContent = lines.join('\n');
        scrollToBottom();
      }

      draw();

      const timer = setInterval(() => {
        frame++;
        if (frame > totalFrames) {
          clearInterval(timer);
          container.remove();
          printRaw('', 'output');
          slRunning = false;
          return;
        }
        draw();
      }, FRAME_MS);

      return null;
    }
    // ============================================================
    // INIT
    // ============================================================
    function init() {
      setTimeout(() => {
        flickerIn(terminalEl, 700, 0.5).then(() => {
          bootSequence().then(() => {
            terminalEl.classList.add('booted');
            inputRow.classList.remove('disabled');
            hiddenInput.focus();
            flickerIn(hintEl, 500, 0.5);
          });
        });
      }, 150);

      inputVisible.addEventListener('click', () => hiddenInput.focus());
      document.querySelector('.terminal').addEventListener('click', (e) => {
        if (e.target.tagName === 'A') return;
        hiddenInput.focus();
      });

      hiddenInput.addEventListener('keydown', onKeyDown);
      hiddenInput.addEventListener('paste', onPaste);
      hiddenInput.addEventListener('input', onHiddenInput);
      hiddenInput.addEventListener('beforeinput', (e) => {
        if (e.inputType !== 'insertFromPaste') e.preventDefault();
      });

      setInterval(() => {
        if (hiddenInput.value !== '') {
          if (hiddenInput.value !== currentInput) {
            currentInput = hiddenInput.value;
            syncView();
          }
          hiddenInput.value = '';
        }
      }, 50);

      window.addEventListener('load', () => hiddenInput.focus());
    }

    init();
  })();