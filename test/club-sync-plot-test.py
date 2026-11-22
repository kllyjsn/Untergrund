import importlib.util
import json
import math
import pathlib
import tempfile

spec = importlib.util.spec_from_file_location('plot', pathlib.Path(__file__).with_name('club-sync-plot.py'))
plot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plot)

assert plot.envelope({}) == ([], [])
capture = {'anchors': [[1, 10000], [2, 11010]], 'samples': [[1.8, .5]],
           'channels': {'kick': {'samples': [[1.1, .2]]}}}
assert plot.envelope(capture) == ([10810.0], [.5])
assert plot.envelope(capture, 'kick') == ([10100.0], [.2])
gapped = {'anchors': [[1, 10000], [2, 26000]], 'samples': [[1, .2], [2, .3]]}
x, y = plot.envelope(gapped)
assert x[0] == 10000 and x[-1] == 26000 and math.isnan(x[1]) and math.isnan(y[1])
with tempfile.TemporaryDirectory() as directory:
    path = pathlib.Path(directory) / 'capture.json'
    data = {'network': {'label': 'test'}, 'results': []}
    path.write_text(json.dumps(data))
    plot.main(path)
    data['results'] = [{'name': 'short-wake-mix', 'run': 1, 'spec': {'mix': True},
                        'failed': True, 'error': 'setup incomplete', 'raw': {'captures': [capture]}}]
    path.write_text(json.dumps(data))
    plot.main(path)
    assert len(list(pathlib.Path(directory).rglob('*.png'))) == 1
    data['network']['label'] = '../escape'
    path.write_text(json.dumps(data))
    try:
        plot.main(path)
        raise AssertionError('Invalid label accepted')
    except ValueError:
        pass
print('Club failure plots PASS: nearest output-clock anchor, isolated channel, capture gaps not interpolated, empty capture/results, partial failed mix PNG, invalid label rejection.')
