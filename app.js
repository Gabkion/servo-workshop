// Raw Code Snippets for 1-Click Copy
const CODE_SNIPPET_1 = `#include <Servo.h>

Servo myServo;

void setup() {
  myServo.attach(9); // Συνδέουμε το servo στο Pin 9
}

void loop() {
  myServo.write(45);   // Θέση 1
  delay(1000);

  myServo.write(135);  // Θέση 2
  delay(1000);
}
`;

const CODE_SNIPPET_2 = `#include <Servo.h>

Servo myServo;

void setup() {
  Serial.begin(9600);
  myServo.attach(9);
  myServo.write(90);   // Αρχική θέση (κέντρο)
}

void loop() {
  if (Serial.available() > 0) {
    char command = Serial.read();

    if (command == '1') {
      myServo.write(45);  // Θέση 1 (45°)
    } 
    else if (command == '2') {
      myServo.write(135); // Θέση 2 (135°)
    }
  }
}
`;

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const connectBtn = document.getElementById('connectBtn');
  const connectBtnText = document.getElementById('connectBtnText');
  const connectionBadge = document.getElementById('connectionBadge');
  const connectionText = document.getElementById('connectionText');

  const servoSlider = document.getElementById('servoSlider');
  const sliderAngleValue = document.getElementById('sliderAngleValue');
  const presetButtons = document.querySelectorAll('.preset-btn');

  const copyCode1Btn = document.getElementById('copyCode1Btn');
  const copyCode2Btn = document.getElementById('copyCode2Btn');

  const sendPos1Btn = document.getElementById('sendPos1Btn');
  const sendPos2Btn = document.getElementById('sendPos2Btn');
  const terminalLogs = document.getElementById('terminalLogs');
  const clearTerminalBtn = document.getElementById('clearTerminalBtn');

  // Terminal Logging Helper
  function logTerminal(message, type = 'system') {
    if (!terminalLogs) return;
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${timeStr}] ${message}`;
    terminalLogs.appendChild(entry);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  // Serial Event Handlers
  window.serialManager.onConnect(() => {
    if (connectionBadge) connectionBadge.classList.add('connected');
    if (connectionText) connectionText.textContent = 'Συνδεδεμένο (WebSerial)';
    if (connectBtn) connectBtn.classList.add('connected');
    if (connectBtnText) connectBtnText.textContent = 'DISCONNECT';
    logTerminal('Συνδέθηκε με το Arduino Leonardo.', 'system');
  });

  window.serialManager.onDisconnect((info) => {
    if (connectionBadge) connectionBadge.classList.remove('connected');
    if (connectionText) connectionText.textContent = 'Αποσυνδεδεμένο';
    if (connectBtn) connectBtn.classList.remove('connected');
    if (connectBtnText) connectBtnText.textContent = 'CONNECT ARDUINO';
    if (info && !info.intentional) {
      logTerminal('Αποσυνδέθηκε (πιθανή επανεκκίνηση / reset board). Αναμονή...', 'system');
    } else {
      logTerminal('Αποσυνδέθηκε από το Arduino.', 'system');
    }
  });

  window.serialManager.onStatus((status) => {
    logTerminal(status, 'system');
  });

  // Controller Incoming Data (Console logging + On-page terminal)
  window.serialManager.onData((data) => {
    // Console log the serial data received from the controller
    console.log('%c[Arduino Controller RX]%c ' + data.replace(/[\r\n]+$/, ''), 'color: #188038; font-weight: bold; font-size: 12px;', 'color: inherit;');
    logTerminal(`[Arduino] ${data.trim()}`, 'received');
  });

  // Connect Button Click
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      if (window.serialManager.isConnected) {
        await window.serialManager.disconnect();
      } else {
        await window.serialManager.connect();
      }
    });
  }

  // Robust Disconnect for Flashing Buttons Click
  const flashReleaseButtons = document.querySelectorAll('.flash-release-action');
  flashReleaseButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.serialManager.prepareForFlashing();
    });
  });

  // Slider & Angle Mechanics
  function updateSlider(angle, sendSerial = true) {
    angle = parseInt(angle, 10);
    if (isNaN(angle)) angle = 90;
    angle = Math.max(0, Math.min(180, angle));

    // Update Slider Value & Angle Label
    if (servoSlider) {
      servoSlider.value = angle;
      const percent = (angle / 180) * 100;
      servoSlider.style.background = `linear-gradient(to right, #1967d2 0%, #1967d2 ${percent}%, #d2e3fc ${percent}%, #d2e3fc 100%)`;
    }
    if (sliderAngleValue) {
      sliderAngleValue.textContent = angle;
    }

    // Transmit over WebSerial if requested and connected
    if (sendSerial && window.serialManager && window.serialManager.isConnected) {
      sendThrottledAngle(angle);
    }
  }

  // Throttled Angle Transmission with backpressure control
  let lastSendTime = 0;
  let pendingAngle = null;
  let throttleTimer = null;
  const THROTTLE_INTERVAL_MS = 60; // 60ms between commands prevents ATmega32U4 buffer overflow

  function sendThrottledAngle(angle) {
    const now = Date.now();

    if (now - lastSendTime >= THROTTLE_INTERVAL_MS) {
      lastSendTime = now;
      console.log('%c[Arduino Controller TX]%c Angle: ' + angle + '°', 'color: #1967d2; font-weight: bold;', 'color: inherit;');
      window.serialManager.send(angle);
      logTerminal(`Έστειλε: ${angle}°`, 'sent');
    } else {
      pendingAngle = angle;
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          if (pendingAngle !== null) {
            console.log('%c[Arduino Controller TX]%c Angle: ' + pendingAngle + '°', 'color: #1967d2; font-weight: bold;', 'color: inherit;');
            window.serialManager.send(pendingAngle);
            logTerminal(`Έστειλε: ${pendingAngle}°`, 'sent');
            lastSendTime = Date.now();
            pendingAngle = null;
          }
        }, THROTTLE_INTERVAL_MS);
      }
    }
  }

  // Slider Input Listener
  if (servoSlider) {
    servoSlider.addEventListener('input', (e) => {
      updateSlider(e.target.value, true);
    });
  }

  // Preset Buttons
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const angle = btn.getAttribute('data-angle');
      updateSlider(angle, true);
    });
  });

  // Initial Slider Render
  updateSlider(90, false);

  // Clipboard Copy Helper
  async function copyToClipboard(text, btnElement) {
    try {
      await navigator.clipboard.writeText(text);
      const textSpan = btnElement.querySelector('.copy-text');
      const originalText = textSpan ? textSpan.textContent : 'ΑΝΤΙΓΡΑΦΗ';
      btnElement.classList.add('copied');
      if (textSpan) textSpan.textContent = 'Copied!';
      setTimeout(() => {
        btnElement.classList.remove('copied');
        if (textSpan) textSpan.textContent = originalText;
      }, 2000);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  if (copyCode1Btn) {
    copyCode1Btn.addEventListener('click', () => {
      copyToClipboard(CODE_SNIPPET_1, copyCode1Btn);
    });
  }

  if (copyCode2Btn) {
    copyCode2Btn.addEventListener('click', () => {
      copyToClipboard(CODE_SNIPPET_2, copyCode2Btn);
    });
  }

  // Action Buttons
  if (sendPos1Btn) {
    sendPos1Btn.addEventListener('click', async () => {
      if (!window.serialManager.isConnected) {
        const wantConnect = confirm('Το Arduino δεν είναι συνδεδεμένο. Θέλετε να το συνδέσετε;');
        if (wantConnect) {
          await window.serialManager.connect();
        }
        return;
      }

      console.log("%c[Arduino Controller TX]%c Command '1' (45°)", 'color: #1967d2; font-weight: bold;', 'color: inherit;');
      const sent = await window.serialManager.send('1');
      if (sent) {
        logTerminal("Απεστάλη: '1' (Θέση 1: 45°)", 'sent');
        updateSlider(45, false);
      }
    });
  }

  if (sendPos2Btn) {
    sendPos2Btn.addEventListener('click', async () => {
      if (!window.serialManager.isConnected) {
        const wantConnect = confirm('Το Arduino δεν είναι συνδεδεμένο. Θέλετε να το συνδέσετε;');
        if (wantConnect) {
          await window.serialManager.connect();
        }
        return;
      }

      console.log("%c[Arduino Controller TX]%c Command '2' (135°)", 'color: #1967d2; font-weight: bold;', 'color: inherit;');
      const sent = await window.serialManager.send('2');
      if (sent) {
        logTerminal("Απεστάλη: '2' (Θέση 2: 135°)", 'sent');
        updateSlider(135, false);
      }
    });
  }

  // Clear Terminal Button
  if (clearTerminalBtn) {
    clearTerminalBtn.addEventListener('click', () => {
      if (terminalLogs) {
        terminalLogs.innerHTML = '';
        logTerminal('Εκκαθάριση.', 'system');
      }
    });
  }
});
