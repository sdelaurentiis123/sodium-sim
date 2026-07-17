"""Reproducible morphology extraction for the public Lightcell confinement video.

The video is deliberately treated as camera evidence, not radiometry. Its
central luminous column is clipped in every analyzed axial row, so RGB values
cannot establish temperature, sodium density, or optical power. The useful
observables are duration, normalized clipped-core width, and centerline motion.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class PixelRoi:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left

    @property
    def height(self) -> int:
        return self.bottom - self.top


PUBLIC_VIDEO_ROI = PixelRoi(left=600, top=175, right=930, bottom=380)


def _nearest_run(indices: np.ndarray, center_x: float) -> np.ndarray | None:
    if indices.size == 0:
        return None
    runs = np.split(indices, np.where(np.diff(indices) > 1)[0] + 1)
    return min(runs, key=lambda run: float(np.min(np.abs(run - center_x))))


def clipped_column_frame_metrics(
    frame_rgb: np.ndarray,
    *,
    roi: PixelRoi = PUBLIC_VIDEO_ROI,
    clip_threshold: int = 245,
    expected_center_x: float | None = None,
    maximum_center_distance_px: float = 70.0,
) -> dict:
    """Measure a clipped luminous column in one decoded RGB frame."""

    if frame_rgb.ndim != 3 or frame_rgb.shape[2] != 3:
        raise ValueError("frame_rgb must have shape (height, width, 3)")
    if not 0 <= clip_threshold <= 255:
        raise ValueError("clip_threshold must be between 0 and 255")
    if roi.left < 0 or roi.top < 0 or roi.right > frame_rgb.shape[1] or roi.bottom > frame_rgb.shape[0]:
        raise ValueError("ROI lies outside frame")

    crop = frame_rgb[roi.top:roi.bottom, roi.left:roi.right]
    clipped = np.min(crop, axis=2) >= clip_threshold
    center = roi.width / 2 if expected_center_x is None else expected_center_x
    widths: list[float] = []
    centers: list[float] = []
    for row in clipped:
        run = _nearest_run(np.flatnonzero(row), center)
        if run is None or float(np.min(np.abs(run - center))) > maximum_center_distance_px:
            continue
        widths.append(float(run.size))
        centers.append(float((run[0] + run[-1]) / 2))

    return {
        "clipped_pixel_fraction": float(np.mean(clipped)),
        "median_core_width_px": float(np.median(widths)) if widths else 0.0,
        "median_center_x_px": float(np.median(centers)) if centers else float("nan"),
        "axial_coverage_fraction": len(widths) / roi.height,
    }


def summarize_frame_metrics(metrics: list[dict], *, roi: PixelRoi) -> dict:
    if not metrics:
        raise ValueError("at least one frame metric is required")
    clipped = np.asarray([row["clipped_pixel_fraction"] for row in metrics])
    widths = np.asarray([row["median_core_width_px"] for row in metrics])
    centers = np.asarray([row["median_center_x_px"] for row in metrics])
    coverage = np.asarray([row["axial_coverage_fraction"] for row in metrics])
    return {
        "sampled_frames": len(metrics),
        "roi": asdict(roi),
        "median_clipped_pixel_fraction": float(np.median(clipped)),
        "clipped_pixel_fraction_p10_p90": [
            float(np.percentile(clipped, 10)),
            float(np.percentile(clipped, 90)),
        ],
        "median_core_width_fraction_of_roi": float(np.median(widths) / roi.width),
        "core_width_fraction_p10_p90": [
            float(np.percentile(widths, 10) / roi.width),
            float(np.percentile(widths, 90) / roi.width),
        ],
        "centerline_jitter_fraction_of_roi": float(np.nanstd(centers) / roi.width),
        "median_axial_coverage_fraction": float(np.median(coverage)),
    }


def analyze_video(
    path: Path,
    *,
    start_s: float = 10.0,
    end_s: float = 150.0,
    interval_s: float = 1.0,
    roi: PixelRoi = PUBLIC_VIDEO_ROI,
) -> dict:
    import cv2

    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError(f"could not open video: {path}")
    duration_s = capture.get(cv2.CAP_PROP_FRAME_COUNT) / capture.get(cv2.CAP_PROP_FPS)
    rows: list[dict] = []
    for timestamp_s in np.arange(start_s, end_s + interval_s / 2, interval_s):
        capture.set(cv2.CAP_PROP_POS_MSEC, float(timestamp_s * 1000))
        ok, frame_bgr = capture.read()
        if not ok:
            continue
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        rows.append(
            clipped_column_frame_metrics(
                frame_rgb,
                roi=roi,
                expected_center_x=132,
            )
        )
    capture.release()
    return {
        "video_duration_s": duration_s,
        "analysis_window_s": [start_s, end_s],
        "sample_interval_s": interval_s,
        "clip_threshold_all_rgb_channels": 245,
        **summarize_frame_metrics(rows, roi=roi),
        "scope": "camera morphology only; exposure-clipped and not radiometrically calibrated",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    arguments = parser.parse_args()
    print(json.dumps(analyze_video(arguments.video), indent=2))


if __name__ == "__main__":
    main()
