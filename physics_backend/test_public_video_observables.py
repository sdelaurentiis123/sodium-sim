import numpy as np
import pytest

from public_video_observables import (
    PixelRoi,
    clipped_column_frame_metrics,
    summarize_frame_metrics,
)


def test_clipped_column_measurement_recovers_width_and_center() -> None:
    frame = np.zeros((20, 30, 3), dtype=np.uint8)
    frame[4:16, 11:17, :] = 255
    roi = PixelRoi(left=5, top=4, right=25, bottom=16)
    measured = clipped_column_frame_metrics(
        frame,
        roi=roi,
        expected_center_x=9,
    )
    assert measured["median_core_width_px"] == 6
    assert measured["median_center_x_px"] == pytest.approx(8.5)
    assert measured["axial_coverage_fraction"] == 1
    assert measured["clipped_pixel_fraction"] == pytest.approx(0.3)


def test_summary_normalizes_camera_morphology_to_roi_width() -> None:
    rows = [
        {
            "clipped_pixel_fraction": 0.1,
            "median_core_width_px": 4,
            "median_center_x_px": 10,
            "axial_coverage_fraction": 1,
        },
        {
            "clipped_pixel_fraction": 0.2,
            "median_core_width_px": 6,
            "median_center_x_px": 12,
            "axial_coverage_fraction": 1,
        },
    ]
    summary = summarize_frame_metrics(
        rows,
        roi=PixelRoi(left=0, top=0, right=20, bottom=10),
    )
    assert summary["median_core_width_fraction_of_roi"] == pytest.approx(0.25)
    assert summary["centerline_jitter_fraction_of_roi"] == pytest.approx(0.05)
