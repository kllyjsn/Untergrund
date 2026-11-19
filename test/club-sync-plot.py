"""Plot failed rendered-audio runs from a club-sync JSON capture."""
import bisect
import json
import math
import pathlib
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def envelope(capture, channel=None):
    anchors = []
    for context, epoch in capture.get('anchors', []):
        if not anchors or context > anchors[-1][0]:
            anchors.append((context, epoch))
    if not anchors:
        return [], []
    times = [a[0] for a in anchors]
    rows = capture.get('channels', {}).get(channel, {}).get('samples', []) if channel else capture.get('samples', [])
    x, y = [], []
    for row in rows:
        i = max(0, min(len(anchors) - 1, bisect.bisect_left(times, row[0])))
        if i and abs(times[i - 1] - row[0]) <= abs(times[i] - row[0]):
            i -= 1
        context, epoch = anchors[i]
        mapped = epoch + (row[0] - context) * 1000
        if x and abs(mapped - x[-1]) > 100:
            x.append(math.nan)
            y.append(math.nan)
        x.append(mapped)
        y.append(row[1])
    return x, y


def main(filename):
    source = pathlib.Path(filename)
    data = json.loads(source.read_text())
    label = data.get('network', {}).get('label', 'default')
    if not label or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in label):
        raise ValueError('Invalid network label')
    destination = source.parent / 'net' / label
    destination.mkdir(parents=True, exist_ok=True)
    for result in data['results']:
        if not result.get('failed'):
            continue
        captures = result.get('raw', {}).get('captures', [])
        mix = result.get('mix')
        is_mix = result.get('spec', {}).get('mix', bool(mix))
        events = result.get('events', {})
        origin = events.get('initial', {}).get('startsAt')
        if origin is None:
            origin = min((a[1] for c in captures for a in c.get('anchors', [])), default=0)
        fig, axes = plt.subplots(3 if is_mix else 1, 1, figsize=(18, 9 if is_mix else 5), squeeze=False, sharex=True)
        axes = axes[:, 0]
        for index, ax in enumerate(axes):
            channel = [None, 'kick', 'vocal'][index]
            for client, capture in enumerate(captures):
                x, y = envelope(capture, channel)
                ax.plot([(t - origin) / 1000 for t in x], y, linewidth=.65, alpha=.8,
                        label=['host', 'listener'][client], color=['#2563eb', '#ea580c'][client])
            if events.get('interruptAt'):
                start = (events['interruptAt'] - origin) / 1000
                end = (events.get('recoverAt', events['interruptAt']) - origin) / 1000
                ax.axvspan(start, end, color='grey', alpha=.18, label='interruption')
                ax.axvline(end, color='black', linestyle=':', linewidth=1)
            ax.set_ylabel(channel or 'destination RMS')
            ax.legend(loc='upper right', fontsize=8)
            ax.grid(alpha=.2)
        phases = mix.get('phases', {}) if mix else {'all':{**result,
            'hostOnsets':result.get('raw', {}).get('hostOnsets', []),
            'listenerOnsets':result.get('raw', {}).get('listenerOnsets', [])}}
        ax = axes[1] if is_mix else axes[0]
        for phase in phases.values():
            kicks = phase.get('kicks', phase)
            paired_host = {p['host'] for p in kicks.get('pairs', [])}
            paired_listener = {p['listener'] for p in kicks.get('pairs', [])}
            for p in kicks.get('pairs', []):
                ax.plot([(p['host'] - origin) / 1000], [.96], '|', transform=ax.get_xaxis_transform(), color='#2563eb', markersize=5)
                ax.plot([(p['listener'] - origin) / 1000], [.9], '|', transform=ax.get_xaxis_transform(), color='#ea580c', markersize=5)
            for key, matched, height, marker in [('hostOnsets', paired_host, .8, 'x'), ('listenerOnsets', paired_listener, .7, '+')]:
                unmatched = [t for t in kicks.get(key, []) if kicks.get('from', -float('inf')) <= t <= kicks.get('to', float('inf')) and t not in matched]
                ax.plot([(t - origin) / 1000 for t in unmatched], [height] * len(unmatched), marker,
                        transform=ax.get_xaxis_transform(), color='red', label='missing' if key == 'hostOnsets' else 'extra')
        handles, labels = ax.get_legend_handles_labels()
        unique = dict(zip(labels, handles))
        ax.legend(unique.values(), unique.keys(), loc='upper right', fontsize=8)
        axes[-1].set_xlabel('seconds from original transport origin; ticks=detected matched kicks, red x=missing, +=extra')
        fig.suptitle(f"{label}: {result['name']} run {result['run']} — " + ', '.join(result.get('failures', []) or [result.get('error', 'threshold failure')[:180]]))
        fig.tight_layout()
        path = destination / f"{source.stem}-{result['name']}-{result['run']}.png"
        fig.savefig(path, dpi=130)
        plt.close(fig)
        print(path)


if __name__ == '__main__':
    main(sys.argv[1])
