#include <Servo.h>

Servo myServo;

void setup() {
  Serial.begin(9600);
  myServo.attach(9); // Pin 9
  myServo.write(90); // Κέντρο
}

void loop() {
  if (Serial.available() > 0) {
    int val = Serial.read();

    // Εντολές από τα κουμπιά
    if (val == '1') {
      myServo.write(45); // Θέση 1
    }
    else if (val == '2') {
      myServo.write(135); // Θέση 2
    }
    // Εντολές από το Slider (μοίρες 0 - 180)
    else if (val >= 0 && val <= 180) {
      myServo.write(val);
    }
  }
}
