"""Physical constants (SI). Sources: CODATA 2018, WGS84 (NIMA TR8350.2)."""

G = 6.67430e-11  # gravitational constant, m^3 kg^-1 s^-2
C = 299_792_458.0  # speed of light, m/s
C2 = C * C

# WGS84 ellipsoid and normal gravity field
WGS84_A = 6_378_137.0  # semi-major axis, m
WGS84_F = 1.0 / 298.257223563  # flattening
WGS84_M = 0.00344978600308  # omega^2 a^2 b / GM
WGS84_GAMMA_E = 9.7803253359  # normal gravity at equator, m/s^2
WGS84_K = 0.00193185265241  # Somigliana constant
WGS84_E2 = 0.00669437999013  # first eccentricity squared
WGS84_U0 = 62_636_851.7146  # normal potential on the ellipsoid, m^2/s^2

# Non-rotating spherical Earth
EARTH_GM = 3.986004418e14  # m^3/s^2
EARTH_MEAN_RADIUS = 6_371_008.8  # m

# Equivalent atom-interferometer gravimeter used for the derived phase signal
AI_WAVELENGTH_M = 780.241e-9  # Rb D2 line
AI_K_EFF = 4.0 * 3.141592653589793 / AI_WAVELENGTH_M  # two-photon effective wavevector, rad/m
AI_PULSE_SEPARATION_S = 0.1  # interferometer time T

# Normal vertical gravity gradient (free-air gradient): converts a station-height error into a gravity error
FREE_AIR_GRADIENT_S2 = 3.086e-6  # s^-2

# Survey logistics
TRANSIT_SPEED_M_S = 5.0  # sensor platform speed between measurement points

# Environmental noise model
ENVIRONMENT_CORRELATION_TIME_S = 1800.0  # first-order Gauss-Markov correlation time
LOCAL_REFERENCE_COMMON_MODE_REJECTION = 0.9  # fraction of environmental noise common to both clocks

# Detection criterion: estimated mass must differ from zero by this many standard deviations
DETECTION_SIGMA = 3.0

# Point-mass approximation is used for a prism when distance exceeds this multiple of its largest dimension
PRISM_FAR_FIELD_RATIO = 50.0
