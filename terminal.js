(function() {
    // ============================================================
    // DOM
    // ============================================================
    const screenEl    = document.getElementById('screen');
    const hiddenInput = document.getElementById('cmdInput');
    const typedText   = document.getElementById('typedText');
    const inputVisible= document.getElementById('inputVisible');
    const inputRow    = document.getElementById('inputRow');
    const inputSubmit = document.getElementById('inputSubmit');
    const mobileInputToggle = document.getElementById('mobileInputToggle');
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
    // Shell parameters like $? / $# / $0 are not exported environment variables,
    // so they live separately from `printenv` output.
    const SHELL_PARAMS = {
      '?': '0',
      '0': 'zsh',
      '#': '0',
      '$': String(42000 + Math.floor(Math.random() * 1000)),
    };

    const ENV_VARS = {
      USER: 'ribs351',
      HOME: '/home/ribs351',
      PWD: '/home/ribs351/portfolio',
      SHELL: '/bin/zsh',
      HOSTNAME: 'ribs351.github.io',
      TERM: 'xterm-256color',
      API_KEY: 'nice_try_fred',
      GITHUB_TOKEN: 'ghp_nice_try_fred',
      NODE_ENV: 'production',
      EDITOR: 'vim',
      LANG: 'en_US.UTF-8',
    };

    const ECHO_VARS = { ...SHELL_PARAMS, ...ENV_VARS };

    let shellCurrentDir = ENV_VARS.PWD;

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
    let pendingSudo = null;

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
      pwd: () => renderPanel([
        { text: `<span class="ok">${shellCurrentDir}</span>` },
      ]),
      cd: () => renderPanel([
        { text: '<span class="warn">Nice try. This isn\'t a real shell.</span>' },
        { blank: true },
        { text: '<span class="dim">There is no filesystem to change here.</span>' },
      ]),
      rm: (args = '') => {
        const targets = args.trim().split(/\s+/).filter(Boolean).filter(arg => !arg.startsWith('-'));

        if (targets.length === 0) {
          return renderPanel([
            { text: '<span class="warn">rm: missing operand</span>' },
            { text: '<span class="dim">Permission denied: there is nothing here to remove.</span>' },
          ]);
        }

        return renderPanel(targets.map(target => ({
          text: `<span class="warn">rm: cannot remove '${escapeHtml(target)}': Permission denied</span>`,
        })));
      },
      uname: (args = '') => {
        const now = new Date();
        const dateStr = now.toUTCString();
        const flags = args.trim();
        const banner = [
          `Linux github.io 6.9.0-portfolio #1 SMP PREEMPT_DYNAMIC ${dateStr} x86_64 GNU/Linux`,
          `Linux github.io 6.9.0-portfolio #1-SMP x86_64`,
        ];

        if (flags === '-a' || flags === '-all') {
          return renderPanel([
            { text: `<span class="ok">${banner[0]}</span>` },
            { blank: true },
            { text: '<span class="dim">this is a fake shell, you know?</span>' },
          ]);
        }

        return renderPanel([
          { text: '<span class="ok">Linux</span>' },
        ]);
      },
      date: (args = '') => {
        const sub = args.trim();
        const parts = sub ? sub.split(/\s+/) : [];
        const command = parts[0] ? parts[0].toLowerCase() : '';
        const rest = parts.slice(1).join(' ');

        const supportedZones = [
          'UTC',
          'America/New_York',
          'America/Los_Angeles',
          'Europe/London',
          'Europe/Berlin',
          'Asia/Tokyo',
          'Australia/Sydney',
        ];

        const formatForZone = (date, timeZone) => {
          try {
            return new Intl.DateTimeFormat('en-US', {
              timeZone,
              dateStyle: 'full',
              timeStyle: 'medium',
            }).format(date);
          } catch {
            return null;
          }
        };

        const parseInputDate = (input) => {
          const trimmed = input.trim();
          if (!trimmed) return null;

          if (trimmed.toLowerCase() === 'today') return new Date();
          if (trimmed.toLowerCase() === 'tomorrow') {
            const d = new Date(); d.setDate(d.getDate() + 1); return d;
          }
          if (trimmed.toLowerCase() === 'yesterday') {
            const d = new Date(); d.setDate(d.getDate() - 1); return d;
          }

          const parsed = new Date(trimmed);
          if (!Number.isNaN(parsed.getTime())) return parsed;

          return null;
        };

        const humanize = (date) => {
          const diffMs = date.getTime() - Date.now();
          const absMs = Math.abs(diffMs);
          const minute = 60 * 1000;
          const hour = 60 * minute;
          const day = 24 * hour;

          if (absMs < minute) return diffMs >= 0 ? 'just now' : 'just now';
          if (absMs < 60 * minute) {
            const mins = Math.round(absMs / minute);
            return diffMs >= 0 ? `${mins} minute${mins === 1 ? '' : 's'} from now` : `${mins} minute${mins === 1 ? '' : 's'} ago`;
          }
          if (absMs < 24 * hour) {
            const hours = Math.round(absMs / hour);
            return diffMs >= 0 ? `${hours} hour${hours === 1 ? '' : 's'} from now` : `${hours} hour${hours === 1 ? '' : 's'} ago`;
          }

          const days = Math.round(absMs / day);
          return diffMs >= 0 ? `${days} day${days === 1 ? '' : 's'} from now` : `${days} day${days === 1 ? '' : 's'} ago`;
        };

        if (sub === '' || sub === '-h' || sub === '--help') {
          return renderPanel([
            { text: '<span class="ok">Date-related commands.</span>' },
            { blank: true },
            { text: "you must use one of the following subcommands. using this command as-is will only produce this help message." },
            { blank: true },
            { text: 'Usage:' },
            { text: '  <span class="ok">&gt; date</span>' },
            { blank: true },
            { text: 'Subcommands:' },
            { label: 'date from-human',    value: 'convert a human readable datetime string to a datetime.' },
            { label: 'date humanize',      value: "print a 'humanized' format for the date, relative to now." },
            { label: 'date list-timezone', value: 'list supported time zones.' },
            { label: 'date now',           value: 'get the current date.' },
            { label: 'date to-timezone',   value: 'convert a date to a given time zone.' },
            { blank: true },
            { text: 'Flags:' },
            { label: '-h, --help',         value: 'display this message again' },
            { blank: true },
            { text: 'Input/output types:' },
            { text: '<span class="dim">#   input      output</span>' },
            { text: '<span class="dim">0   nothing    string</span>' },
          ]);
        }

        if (command === 'now') {
          return renderPanel([
            { text: `<span class="ok">${new Date().toString()}</span>` }
          ]);
        }

        if (command === 'from-human') {
          const value = parseInputDate(rest);
          if (!value) {
            return renderPanel([
              { text: '<span class="warn">error: could not parse the supplied datetime.</span>' },
              { text: '<span class="dim">try something like: 2026-09-17T12:00:00Z or today.</span>' },
            ]);
          }

          return renderPanel([
            { text: `<span class="ok">${value.toISOString()}</span>` },
            { blank: true },
            { text: `<span class="dim">${value.toString()}</span>` },
          ]);
        }

        if (command === 'humanize') {
          const value = parseInputDate(rest) || new Date();
          return renderPanel([
            { text: `<span class="ok">${humanize(value)}</span>` },
          ]);
        }

        if (command === 'list-timezone') {
          return renderPanel([
            { text: '<span class="dim">supported time zones</span>' },
            { blank: true },
            ...supportedZones.map(zone => ({ label: zone, value: formatForZone(new Date(), zone) || 'unavailable' })),
          ]);
        }

        if (command === 'to-timezone') {
          const tzTokens = rest.split(/\s+/).filter(Boolean);
          if (tzTokens.length < 2) {
            return renderPanel([
              { text: '<span class="warn">error: expected <datetime> <timezone>.</span>' },
              { text: '<span class="dim">example: date to-timezone 2026-09-17T12:00:00Z America/New_York</span>' },
            ]);
          }

          const dateText = tzTokens[0];
          const targetZone = tzTokens.slice(1).join(' ');
          const parsed = parseInputDate(dateText);
          if (!parsed) {
            return renderPanel([
              { text: '<span class="warn">error: invalid datetime.</span>' },
              { text: '<span class="dim">use ISO-like strings such as 2026-09-17T12:00:00Z.</span>' },
            ]);
          }

          const formatted = formatForZone(parsed, targetZone);
          if (!formatted) {
            return renderPanel([
              { text: `<span class="warn">error: unsupported time zone '${escapeHtml(targetZone)}'</span>` },
              { text: '<span class="dim">try one of: UTC, America/New_York, Europe/London, Asia/Tokyo.</span>' },
            ]);
          }

          return renderPanel([
            { text: `<span class="ok">${formatted}</span>` },
            { blank: true },
            { text: `<span class="dim">timezone: ${escapeHtml(targetZone)}</span>` },
          ]);
        }

        return renderPanel([
          { text: `<span class="warn">error: unknown subcommand '${escapeHtml(sub)}'</span>` },
          { text: '<span class="dim">type `date` for the help menu.</span>' },
        ]);
      },
      printenv: () => {
        const envRows = Object.entries(ENV_VARS).map(([key, value]) => ({
          label: key,
          value: value,
        }));

        return renderPanel([
          ...envRows,
        ]);
      },
      fastfetch: () => fastfetchCommand(),
      help: () => renderPanel([
        { text: 'available commands:' },
        { blank: true },
        { label: 'whoami',    value: 'who am i, roughly' },
        { label: 'projects',  value: "things i've built (or am building)" },
        { label: 'contact',   value: 'ways to reach me' },
        { label: 'pwd',       value: 'print the current working directory' },
        { label: 'cd',        value: 'change directory' },
        { label: 'uname',     value: 'print OS details' },
        { label: 'printenv',  value: 'show environment variables' },
        { label: 'date',      value: 'date-related commands' },
        { label: 'fastfetch',  value: 'you know what this does' },
        { label: 'echo',      value: 'print things (mostly)' },
        { label: 'rm',        value: 'remove something' },
        { label: 'sudo',      value: "don't" },
        { label: 'clear',     value: 'clear the screen' },
        { label: 'help',      value: 'show this list again' },
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

    function wait(milliseconds) {
      return new Promise(resolve => setTimeout(resolve, milliseconds));
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

    function syncView() {
      typedText.textContent = pendingSudo ? '*'.repeat(currentInput.length) : currentInput;
    }

    function clearInput() {
      currentInput = '';
      syncView();
      hiddenInput.value = '';
    }

    function onKeyDown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitInput();
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

    function submitInput() {
      const cmd = currentInput;
      runCommand(cmd);
      clearInput();
      scrollToBottom();
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

      if (pendingSudo) {
        const sudoAction = pendingSudo;
        pendingSudo = null;

        if (sudoAction === 'nuke') {
          printRaw('<span class="ok">eh, close enough.</span>', 'output');
          await wait(2000);
          await fakeNukeSequence();
        } else {
          sudoAttempts++;

          if (sudoAttempts === 5) {
            printRaw('<span class="warn">Permission denied.</span>', 'output');
            printRaw('<span class="dim">security has been notified.</span>', 'output');
            printRaw('<span class="dim">(security is one guy named Steve.)</span>', 'output');
          } else if (sudoAttempts === 7) {
            printRaw('<span class="warn">Permission denied.</span>', 'output');
            printRaw('<span class="dim">sudo has been added to the watchlist.</span>', 'output');
            printRaw('<span class="dim">the watchlist is a text file.</span>', 'output');
          } else if (sudoAttempts >= 10) {
            printRaw('<span class="warn">Permission denied: absolutely not.</span>', 'output');
            printRaw('<span class="dim">terminal locked for 3 seconds.</span>', 'output');
            lockTerminal(3);
          } else {
            const response = sudoResponses[Math.min(sudoAttempts - 1, sudoResponses.length - 1)];
            printRaw(`<span class="warn">${response}</span>`, 'output');
            printRaw(`<span class="dim">sudo attempts: ${sudoAttempts}</span>`, 'output');
          }
          printRaw('', 'output');
        }
        return;
      }

      const cmd = raw.trim();
      printRaw(`<span class="prompt-symbol">$</span> ${escapeHtml(cmd)}`, 'prompt-line');

      if (cmd === '') {
        printRaw('', 'output');
        return;
      }

      if (/^sudo(?:\s|$)/i.test(cmd)) {
        pendingSudo = /^sudo\s+rm\s+-rf\s+\/$/i.test(cmd) ? 'nuke' : 'reject';
        printRaw('<span class="dim">[sudo] password for ribs351:</span>', 'output');
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
    // fastfetch
    // ============================================================
    function fastfetchCommand() {
      // The cat
      const CAT = [
        "      /\\_/\\  ",
        "     ( o.o ) ",
        "      > ^ <  ",
        "     /     \\ ",
        "    (       )",
        "     `-----' ",
      ];

      const INFO = [
        ['',                   'ribs351@github.io'],
        ['',                   '------------------'],
        ['OS',                 'Debian GNU/Linux (GitHub Pages Edition)'],
        ['Host',               'github.io'],
        ['Kernel',             '6.9.0-portfolio'],
        ['Uptime',             'eternally optimistic'],
        ['Shell',              '/bin/zsh'],
        ['Terminal',           'HTML + CSS + mild deception'],
        ['Packages',           'C# / .NET 8 / chaos'],
        ['Theme',              'highly caffeinated, tired asf'],
      ];

      const infoLines = INFO.map(([key, val], idx) => {
        if (idx === 0) return `<span class="ok">${escapeHtml(val)}</span>`;
        if (idx === 1) return `<span class="dim">${escapeHtml(val)}</span>`;
        const k = escapeHtml(key.padEnd(10, ' '));
        const v = escapeHtml(val);
        return `<span class="dim">${k}</span> ${v}`;
      });

      const rows = Math.max(CAT.length, infoLines.length);

      // Compose each visual row: cat (left) + two spaces + info (right).
      const GAP = '  ';
      const composed = [];
      for (let i = 0; i < rows; i++) {
        const catRow  = (CAT[i]      ?? '').padEnd(14, ' ');
        const infoRow =  infoLines[i] ?? '';
        composed.push(catRow + GAP + infoRow);
      }

      const container = document.createElement('div');
      container.className = 'line output';
      const pre = document.createElement('pre');
      pre.style.margin = '0';
      pre.style.font = 'inherit';
      pre.style.lineHeight = '1.15';
      pre.innerHTML = composed.join('\n');
      container.appendChild(pre);
      screenEl.appendChild(container);

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
      inputSubmit.addEventListener('click', submitInput);
      mobileInputToggle.addEventListener('click', () => {
        const isOpen = terminalEl.classList.toggle('input-open');
        mobileInputToggle.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) hiddenInput.focus();
      });
      document.querySelector('.terminal').addEventListener('click', (e) => {
        if (e.target.tagName === 'A' || e.target === mobileInputToggle || mobileInputToggle.contains(e.target)) return;
        hiddenInput.focus();
      });

      hiddenInput.addEventListener('keydown', onKeyDown);
      hiddenInput.addEventListener('paste', onPaste);
      hiddenInput.addEventListener('input', onHiddenInput);

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