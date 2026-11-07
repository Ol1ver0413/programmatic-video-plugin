"""Optional waveform evidence for recording location and encoded/source comparison."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

try:
    import numpy as np
except ImportError:
    raise SystemExit('Audio audit requires Python 3 and NumPy: install numpy in your chosen environment.')


def samples(file, rate):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(file), '-vn', '-ac', '1',
                             '-ar', str(rate), '-f', 'f32le', 'pipe:1'], capture_output=True)
    if result.returncode:
        raise ValueError(result.stderr.decode('utf-8', errors='replace'))
    data = np.frombuffer(result.stdout, dtype='<f4').astype(np.float64)
    if not len(data) or not np.isfinite(data).all():
        raise ValueError('Audio has no finite decoded samples')
    return data


def normalized(a, b):
    a, b = a - a.mean(), b - b.mean()
    norm = np.sqrt(np.dot(a, a) * np.dot(b, b))
    if norm <= 1e-20:
        raise ValueError('Waveform evidence requires non-silent, non-constant signals')
    return float(np.clip(np.dot(a, b) / norm, -1, 1))


def locate(source, reference, start, seconds, rate):
    if np.var(source) <= 1e-20:
        raise ValueError('Source recording has no waveform variation')
    first, last = round(start * rate), round((start + seconds) * rate)
    if first < 0 or last > len(reference) or last <= first:
        raise ValueError('Window must fit inside the reference recording')
    segment = reference[first:last].copy()
    segment -= segment.mean()
    count = len(segment)
    if count > len(source) or np.dot(segment, segment) <= 1e-20:
        raise ValueError('Window is longer than source or has no waveform variation')
    size = 1 << (len(source) + count - 2).bit_length()
    dot = np.fft.irfft(np.fft.rfft(source, size) * np.fft.rfft(segment[::-1], size), size)[count-1:len(source)]
    sums = np.concatenate(([0.0], np.cumsum(source)))
    squares = np.concatenate(([0.0], np.cumsum(source * source)))
    energy = squares[count:] - squares[:-count] - (sums[count:] - sums[:-count])**2 / count
    norm = np.sqrt(np.maximum(energy, 1e-20) * np.dot(segment, segment))
    scores = dot / norm
    index = int(np.argmax(scores))
    return dict(reference_start=start, window_seconds=seconds, source_start=index/rate,
                correlation=float(np.clip(scores[index], -1, 1)), inferred_origin_seconds=index/rate-start)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['locate', 'verify'], required=True)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--sample-rate', type=int, default=8000)
    parser.add_argument('--windows', help='Comma-separated reference start times for locate mode')
    parser.add_argument('--duration', type=float, help='Locate window length; default up to four seconds')
    args = parser.parse_args()
    if args.out.suffix.lower() != '.json':
        raise ValueError('Audio audit report output must be .json')
    if args.out.exists():
        raise ValueError('Refusing to overwrite existing report')
    if not 1000 <= args.sample_rate <= 48000:
        raise ValueError('sample-rate must be from 1000 to 48000')
    if args.mode == 'verify' and (args.windows is not None or args.duration is not None):
        raise ValueError('windows and duration apply only to locate mode')
    a, b = samples(args.input, args.sample_rate), samples(args.reference, args.sample_rate)
    report = dict(mode=args.mode, input_file=args.input.name, reference_file=args.reference.name,
                  sample_rate=args.sample_rate, input_seconds=len(a)/args.sample_rate,
                  reference_seconds=len(b)/args.sample_rate,
                  limitation='Waveform evidence concerns recordings and global timing, not word/phoneme alignment, artistic quality or user acceptance. Audition uncertain matches; no acceptance threshold is inferred.')
    if args.mode == 'verify':
        count = min(len(a), len(b))
        report.update(method='zero-offset normalized waveform correlation', correlation=normalized(a[:count], b[:count]),
                      compared_seconds=count/args.sample_rate, reference_coverage=count/len(b),
                      duration_difference_seconds=(len(a)-len(b))/args.sample_rate)
    else:
        seconds = args.duration if args.duration is not None else min(4, len(b)/args.sample_rate/3)
        if not np.isfinite(seconds) or seconds <= 0:
            raise ValueError('duration must be finite and positive')
        available = len(b)/args.sample_rate-seconds
        windows = [float(t) for t in args.windows.split(',')] if args.windows else [0, available/2, available]
        if not windows or not all(np.isfinite(t) for t in windows):
            raise ValueError('windows must contain finite reference times')
        matches = [locate(a, b, t, seconds, args.sample_rate) for t in dict.fromkeys(windows)]
        origins = [m['inferred_origin_seconds'] for m in matches]
        report.update(method='normalized waveform cross-correlation across reference windows', matches=matches,
                      candidate_origin_seconds=float(np.median(origins)), origin_spread_seconds=max(origins)-min(origins))
    report['input_sha256'] = hashlib.sha256(args.input.read_bytes()).hexdigest()
    report['reference_sha256'] = hashlib.sha256(args.reference.read_bytes()).hexdigest()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x', encoding='utf-8') as file:
        json.dump(report, file, ensure_ascii=False, indent=2)
        file.write('\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
