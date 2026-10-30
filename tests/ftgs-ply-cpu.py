#!/usr/bin/env python3
"""Full-asset CPU reference: source FTGS equations vs actual JS loader records.

python tests/ftgs-ply-cpu.py --input SOURCE.ftgs.ply --out EMPTY_OUTPUT_DIR
Requires NumPy, plyfile and Node. No torch/CUDA import or graphics context.
Formula references: FreeTimeGsVanilla/src/freetime_ops.py:48-57;
simple_trainer_freetime_4d_pure_relocation.py:1533-1540.
"""
import argparse
import json
from pathlib import Path
import subprocess

import numpy as np
from plyfile import PlyData


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    args=p.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    ply=PlyData.read(args.input); v=ply['vertex'].data; n=len(v)
    comments=dict(c.split(' ',1) for c in ply.comments if ' ' in c)
    result=subprocess.run(['node',str(Path(__file__).with_name('ftgs-ply-probe.mjs')),str(args.input.resolve()),str(args.out.resolve())],check=True,text=True,capture_output=True)
    (args.out/'probe.log').write_text(result.stdout+result.stderr)
    summary=json.loads((args.out/'js-summary.json').read_text())
    assert summary['gaussian_count']==n
    runtime=np.fromfile(args.out/'runtime.f32',dtype='<f4').reshape(-1,128)[:n]
    actual=np.fromfile(args.out/'evaluations.f64',dtype='<f8').reshape(3,n,4)
    def columns(names): return np.column_stack([v[name] for name in names])
    positions=columns(['x','y','z']); velocities=columns([f'velocity_{i}' for i in range(3)])
    quats=columns([f'rot_{i}' for i in range(4)])
    scales=columns([f'scale_{i}' for i in range(3)]).astype('f8')
    use_velocity=comments['use_velocity']=='1'
    centers=v['time'].astype('f8'); sigma=np.exp(v['log_duration'].astype('f8'))
    logits=v['opacity'].astype('f8')
    base_opacity=np.exp(-np.logaddexp(0,-logits))
    floor=float(comments['opacity_floor'])
    # Raw geometric and full SH parameters must survive direct loading bitwise.
    def bits_equal(a,b): return np.array_equal(np.ascontiguousarray(a).view('<u4'),np.ascontiguousarray(b).view('<u4'))
    assert bits_equal(runtime[:,:3],positions)
    assert bits_equal(runtime[:,3:7],quats)
    assert bits_equal(runtime[:,11],v['time'])
    assert bits_equal(runtime[:,13:16],velocities if use_velocity else np.zeros_like(velocities))
    assert np.all(runtime[:,16:26]==0)
    degree=int(comments['sh_degree']); bases=(degree+1)**2
    sh=np.empty((n,3*bases),dtype='<f4')
    for ch in range(3):
        sh[:,ch*bases]=v[f'f_dc_{ch}']
        for j in range(1,bases): sh[:,ch*bases+j]=v[f'f_rest_{ch*(bases-1)+j-1}']
    assert bits_equal(runtime[:,26:26+3*bases],sh)
    # Activation parameters are uploaded as float32, not quantized to half/RGBA.
    expected_scale=np.exp(scales).astype('f4')
    expected_width=(np.sqrt(2)*sigma).astype('f4')
    expected_opacity=base_opacity.astype('f4')
    np.testing.assert_allclose(runtime[:,7:10],expected_scale,rtol=1.2e-7,atol=0)
    np.testing.assert_allclose(runtime[:,12],expected_width,rtol=1.2e-7,atol=0)
    np.testing.assert_allclose(runtime[:,10],expected_opacity,rtol=1.2e-7,atol=0)
    per_time=[]
    for tick,t in enumerate([0,.5,1]):
        dt=t-centers
        # Official positions_at_time and temporal_opacity equations, independently
        # evaluated from source parameters in float64, followed by training floor.
        pos=positions.astype('f8')+(velocities.astype('f8')*dt[:,None] if use_velocity else 0)
        opacity=np.maximum(base_opacity*np.exp(-0.5*(dt/sigma)**2),floor)
        pos_error=np.abs(actual[tick,:,:3]-pos)
        opacity_error=np.abs(actual[tick,:,3]-opacity)
        assert float(pos_error.max(initial=0))<1e-12
        assert float(opacity_error.max(initial=0))<2e-7
        per_time.append(dict(time=t,gaussian_count=n,position_max_abs_error=float(pos_error.max(initial=0)),
                             opacity_max_abs_error=float(opacity_error.max(initial=0))))
    report=dict(summary=summary,source_fields_per_vertex=len(v.dtype.names),source_record_bytes=v.dtype.itemsize,
        raw_geometry_and_sh_bit_equal=True,full_sh_coefficients_checked=n*3*bases,per_time=per_time,
        position_max_abs_error=max(r['position_max_abs_error'] for r in per_time),
        opacity_max_abs_error=max(r['opacity_max_abs_error'] for r in per_time),
        note='All source vertices at all three times; reference float64 vs actual float32 runtime records. No GPU execution.')
    (args.out/'cpu-results.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))


if __name__=='__main__': main()
