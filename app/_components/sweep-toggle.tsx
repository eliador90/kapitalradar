"use client";

// Turns the radar sweep on or off; on by default, remembered per browser. Reduced motion turns
// the animation off in CSS regardless of this setting.
import { useEffect, useState } from "react";

const KEY = "kr-sweep";

export function SweepToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "0") setOn(false);
    } catch {
      // Storage blocked (private mode): keep the default.
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.sweep = on ? "on" : "off";
  }, [on]);
  const toggle = () => {
    setOn(!on);
    try {
      localStorage.setItem(KEY, on ? "0" : "1");
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  };
  return (
    <button className="toggle" type="button" aria-pressed={on} onClick={toggle} title="Turn the radar animation on or off">
      Sweep {on ? "on" : "off"}
    </button>
  );
}
