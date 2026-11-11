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

    if (val >= 0 && val <= 180) {
      myServo.write(val);
    }
  }
}
