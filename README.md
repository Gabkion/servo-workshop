# Servo Workshop

Εκπαιδευτική ιστοσελίδα για το εργαστήριο ελέγχου σερβοκινητήρα (SG90) με Arduino Leonardo (ATmega32U4) μέσω WebSerial.

## Περιεχόμενα

1. **Έλεγχος Καλωδίωσης (Pin 9)**
   - Σύνδεση με το Arduino μέσω WebSerial (9600 baud).
   - Slider (0° - 180°) και κουμπιά άμεσης επιλογής θέσεων (0°, 45°, 90°, 135°, 180°).
   - Οδηγός καλωδίωσης (GND: Καφέ/Μαύρο, 5V: Κόκκινο, Pin 9: Πορτοκαλί).

2. **Αυτόνομη Κίνηση (Servo Sweep)**
   - Κώδικας Arduino (.ino) για αυτόματη εναλλαγή θέσεων (45° και 135°).
   - Κουμπί άμεσης αντιγραφής.

3. **Σειριακός Έλεγχος (Serial Control)**
   - Κώδικας για ανάγνωση σειριακών εντολών από τον υπολογιστή (`'1'` για 45° και `'2'` για 135°).
   - Οδηγίες δοκιμής μέσω του Serial Monitor του Arduino IDE.

4. **Έλεγχος από την Ιστοσελίδα**
   - Κουμπιά αποστολής εντολών για Θέση 1 (45°) και Θέση 2 (135°).
   - Καταγραφή σειριακής επικοινωνίας (Serial Monitor + Browser DevTools Console) με διαχείριση backpressure και αυτόματη επανασύνδεση.

## Χαρακτηριστικά WebSerial Client για Arduino Leonardo (ATmega32U4)

- **Console Logging**: Πλήρης καταγραφή των δεδομένων του controller (RX) και των απεσταλμένων εντολών (TX) στην κονσόλα του περιηγητή (DevTools Console).
- **Αποδέσμευση για Flashing (`flashReleaseBtn`)**: Κουμπί άμεσης αποδέσμευσης της σειριακής θύρας. Ακυρώνει όλα τα active streams, απελευθερώνει τα reader/writer locks και κλείνει το `port.close()`, επιτρέποντας στο Arduino IDE / avrdude να φλασάρει τον bootloader χωρίς σφάλμα «Access Denied».
- **Explicit Signal Control (DTR / RTS)**: Ρητή αρχικοποίηση DTR (`dataTerminalReady: true`) και RTS (`requestToSend: false`) για αποφυγή ανεπιθύμητου software reset στον bootloader (1200 baud touch).
- **Re-enumeration & Event Handling**: Παρακολούθηση γεγονότων `connect` / `disconnect` του WebSerial και αυτόματος μηχανισμός polling για επανασύνδεση όταν η πλακέτα επανέλθει σε application mode (`2341:8036`).
- **Backpressure & Write Queuing**: Σειριακή ουρά εγγραφών με αναμονή του `writer.ready` και throttling εντολών (60ms) για προστασία του CDC ring buffer του ATmega32U4.

## Χρήση

1. Ανοίξτε το `index.html` σε περιηγητή που υποστηρίζει WebSerial (Google Chrome, Microsoft Edge, Opera).
2. Συνδέστε το Arduino Leonardo μέσω USB.
3. Πατήστε **CONNECT ARDUINO** και επιλέξτε τη σειριακή θύρα.
4. Όταν θέλετε να ανεβάσετε νέο κώδικα από το Arduino IDE, πατήστε **ΑΠΟΔΕΣΜΕΥΣΗ ΓΙΑ FLASH** πάνω δεξιά.
