import copy

import pytest
from pydantic import ValidationError

from engine.config import ExperimentConfig, configuration_hash
from engine.validation import format_limit, validate_config


def _errors(cfg):
    report = validate_config(ExperimentConfig.model_validate(cfg))
    return {e["field"]: e["message"] for e in report.errors}, report


def test_default_config_is_valid(config_dict):
    errors, report = _errors(config_dict)
    assert errors == {}
    assert report.derived is not None
    assert report.derived["survey"]["point_count"] == 33 * 33


def test_negative_depth_message(config_dict):
    config_dict["bodies"][0]["depth_m"] = -5
    errors, _ = _errors(config_dict)
    assert errors["bodies.0.depth_m"] == "Depth must be greater than 0 m."


def test_zero_density(config_dict):
    config_dict["bodies"][0]["density_contrast_kg_m3"] = 0
    errors, _ = _errors(config_dict)
    assert errors["bodies.0.density_contrast_kg_m3"] == "Density contrast must be greater than 0 kg/m³."


def test_body_above_surface(config_dict):
    config_dict["bodies"][0]["depth_m"] = 500  # sphere radius ≈ 927 m
    errors, _ = _errors(config_dict)
    assert errors["bodies.0.depth_m"].startswith("Body extends above the ground surface.")


def test_terrain_relief_tightens_geometry(config_dict):
    config_dict["bodies"][0]["depth_m"] = 1000  # top at ≈ 73 m depth
    config_dict["environment"]["terrain"] = "hills"
    config_dict["environment"]["terrain_relief_m"] = 200  # ground dips to −100 m
    errors, _ = _errors(config_dict)
    assert "bodies.0.depth_m" in errors


def test_overlapping_bodies(config_dict):
    second = copy.deepcopy(config_dict["bodies"][0])
    second["id"] = "body-2"
    second["x_m"] += 100
    config_dict["bodies"].append(second)
    errors, _ = _errors(config_dict)
    assert errors["bodies.1"] == "Body 2 overlaps body 1. Move or resize one of them."


def test_too_many_points(config_dict):
    config_dict["survey"]["spacing_m"] = 10
    errors, _ = _errors(config_dict)
    message = errors["survey.spacing_m"]
    assert "maximum is 100 000" in message
    assert "at least" in message


def test_too_coarse(config_dict):
    config_dict["survey"]["spacing_m"] = 5000
    errors, _ = _errors(config_dict)
    assert errors["survey.spacing_m"].startswith("Resolution is too coarse")


def test_preset_frequency_must_match(config_dict):
    config_dict["sensor"]["reference_frequency_hz"] = 4.0e14
    errors, _ = _errors(config_dict)
    assert "sensor.reference_frequency_hz" in errors
    config_dict["sensor"]["clock_species"] = "custom"
    errors, _ = _errors(config_dict)
    assert "sensor.reference_frequency_hz" not in errors


def test_nan_and_infinity_rejected_by_schema(config_dict):
    config_dict["bodies"][0]["mass_kg"] = float("nan")
    with pytest.raises(ValidationError):
        ExperimentConfig.model_validate(config_dict)
    config_dict["bodies"][0]["mass_kg"] = float("inf")
    with pytest.raises(ValidationError):
        ExperimentConfig.model_validate(config_dict)


def test_hash_ignores_name(config_dict):
    a = ExperimentConfig.model_validate(config_dict)
    config_dict["name"] = "Renamed"
    b = ExperimentConfig.model_validate(config_dict)
    assert configuration_hash(a) == configuration_hash(b)
    config_dict["bodies"][0]["depth_m"] = 1600
    c = ExperimentConfig.model_validate(config_dict)
    assert configuration_hash(a) != configuration_hash(c)


def test_format_limit():
    assert format_limit(1e6) == "10⁶"
    assert format_limit(2.5e-19) == "2.5 × 10⁻¹⁹"
    assert format_limit(0.1) == "0.1"
    assert format_limit(-90) == "−90"
