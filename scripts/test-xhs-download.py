#!/usr/bin/env python3
"""Measure XHS thumbnail downloads. Requires only Python 3; no Feishu writes."""

import argparse
import concurrent.futures
import json
import time
import urllib.error
import urllib.request
from pathlib import Path


IMAGE_IDS = [
    '1040g0083266b9vu5lg0048tq0pk8rc3i14natc0',
    '1040g008326670tpe5g0048tq0pk8rc3i1hi92tg',
    '1040g00832666jtn95g0048tq0pk8rc3il8il7n0',
]


def positive_int(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError('must be positive')
    return number


def download(index, image_id, args, round_number):
    url = ('https://sns-img-qc.xhscdn.com/{}'
           '?imageView2/2/w/{}/h/{}/format/jpg').format(
               image_id, args.width, args.height)
    started = time.perf_counter()
    result = {'image': index, 'url': url, 'status': None, 'bytes': 0,
              'first_byte_seconds': None, 'ok': False}
    output = None
    try:
        request = urllib.request.Request(url, headers={
            'Referer': 'https://www.xiaohongshu.com/',
            'User-Agent': 'Mozilla/5.0',
        })
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            result['status'] = response.status
            result['content_type'] = response.headers.get('Content-Type', '')
            if args.save_dir:
                path = Path(args.save_dir) / 'round-{}-image-{}.jpg'.format(round_number, index)
                output = path.open('wb')
                result['file'] = str(path)
            while True:
                if time.perf_counter() - started > args.timeout:
                    raise TimeoutError('total download time budget exceeded')
                chunk = response.read(64 * 1024)
                if result['first_byte_seconds'] is None:
                    result['first_byte_seconds'] = round(time.perf_counter() - started, 4)
                if not chunk:
                    break
                result['bytes'] += len(chunk)
                if output:
                    output.write(chunk)
            result['ok'] = (response.status == 200 and result['bytes'] > 0
                            and result['content_type'].lower().startswith('image/'))
            if not result['ok']:
                result['error'] = 'response is not a successful nonempty image'
    except urllib.error.HTTPError as error:
        result['status'] = error.code
        result['error'] = str(error)
        error.close()
    except Exception as error:
        result['error'] = str(error)
    finally:
        if output:
            output.close()
        result['total_seconds'] = round(time.perf_counter() - started, 4)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--width', type=positive_int, default=1920)
    parser.add_argument('--height', type=positive_int, default=1080)
    parser.add_argument('--concurrency', type=positive_int, default=3)
    parser.add_argument('--rounds', type=positive_int, default=1)
    parser.add_argument('--timeout', type=positive_int, default=30,
                        help='socket timeout and best-effort total budget in seconds')
    parser.add_argument('--save-dir', help='optional directory for downloaded JPEG files')
    parser.add_argument('--json-out', help='optional path for full JSON report')
    args = parser.parse_args()
    if args.save_dir:
        Path(args.save_dir).mkdir(parents=True, exist_ok=True)
    report = {'width': args.width, 'height': args.height,
              'concurrency': args.concurrency, 'rounds': []}
    print('JPEG, bounding box {}x{}, concurrency={}, Referer=xiaohongshu.com'.format(
        args.width, args.height, args.concurrency))
    for round_number in range(1, args.rounds + 1):
        started = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = [pool.submit(download, i, image_id, args, round_number)
                       for i, image_id in enumerate(IMAGE_IDS, 1)]
            results = [future.result() for future in futures]
        wall_seconds = round(time.perf_counter() - started, 4)
        report['rounds'].append({'round': round_number,
                                'wall_seconds': wall_seconds, 'results': results})
        print('\nRound {}'.format(round_number))
        for result in results:
            print('image={} status={} bytes={} first_byte={}s total={}s {}'.format(
                result['image'], result['status'], result['bytes'],
                result['first_byte_seconds'], result['total_seconds'],
                result.get('error', 'OK')))
        print('Batch wall time: {}s; total bytes: {}'.format(
            wall_seconds, sum(result['bytes'] for result in results)))
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return 0 if all(item['ok'] for batch in report['rounds'] for item in batch['results']) else 1


if __name__ == '__main__':
    raise SystemExit(main())
