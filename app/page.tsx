import type { Metadata } from "next";
import SimulationDashboard from "./simulation-dashboard";

export const metadata: Metadata = {
  title: "Na·D Transport Lab",
  description:
    "An interactive Monte Carlo model of resonance-radiation trapping in a cylindrical sodium vapor.",
};

export default function Home() {
  return <SimulationDashboard />;
}
