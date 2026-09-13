"use client";

import { useEffect, useState } from "react";

const launchTarget = new Date("2027-04-12T00:00:00+01:00").getTime();
const initial = { days: "—", hours: "—", minutes: "—", seconds: "—" };

export function LaunchCountdown() {
  const [remaining, setRemaining] = useState(initial);
  useEffect(() => {
    const tick = () => {
      const delta = Math.max(0, launchTarget - Date.now());
      const totalSeconds = Math.floor(delta / 1000);
      setRemaining({
        days: String(Math.floor(totalSeconds / 86400)),
        hours: String(Math.floor((totalSeconds % 86400) / 3600)).padStart(
          2,
          "0",
        ),
        minutes: String(Math.floor((totalSeconds % 3600) / 60)).padStart(
          2,
          "0",
        ),
        seconds: String(totalSeconds % 60).padStart(2, "0"),
      });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div aria-label="Countdown to the planned LocalHub launch target">
      <strong>{remaining.days}</strong> days ·{" "}
      <strong>{remaining.hours}</strong> hours ·{" "}
      <strong>{remaining.minutes}</strong> minutes ·{" "}
      <strong>{remaining.seconds}</strong> seconds
    </div>
  );
}
