"""Emit WAT; see src/utils/depth-sort.md for the reproducible build command."""
print('''(module
(memory (export "memory") 1)
(func (export "depths") (param $pairs i32) (param $out i32) (param $motion i32)
 (param $time f64) (param $vx f64) (param $vy f64) (param $vz f64)
 (local $p i32) (local $dt v128) (local $dt2 v128) (local $dt3 v128)
 (local $x v128) (local $y v128) (local $z v128)
 (loop $loop''')
for axis, name in enumerate('xyz'):
    print(f'(local.set ${name} (v128.load offset={axis*16} (local.get $p)))')
print('''(if (local.get $motion) (then
(local.set $dt (f64x2.sub (f64x2.splat (local.get $time)) (v128.load offset=192 (local.get $p))))
(local.set $dt2 (f64x2.mul (local.get $dt) (local.get $dt)))
(local.set $dt3 (f64x2.mul (local.get $dt2) (local.get $dt)))''')
for axis,name in enumerate('xyz'):
    terms=[f'(f64x2.mul (v128.load offset={(3+axis+3*k)*16} (local.get $p)) (local.get ${dt}))' for k,dt in enumerate(['dt','dt2','dt3'])]
    print(f'(local.set ${name} (f64x2.add (local.get ${name}) (f64x2.add (f64x2.add {terms[0]} {terms[1]}) {terms[2]})))')
print('''))
(v128.store (local.get $out) (f64x2.mul
 (f64x2.add (f64x2.add
  (f64x2.mul (f64x2.splat (local.get $vx)) (local.get $x))
  (f64x2.mul (f64x2.splat (local.get $vy)) (local.get $y)))
  (f64x2.mul (f64x2.splat (local.get $vz)) (local.get $z)))
 (f64x2.splat (f64.const 4096))))
(local.set $out (i32.add (local.get $out) (i32.const 16)))
(local.set $p (i32.add (local.get $p) (i32.const 208)))
(local.set $pairs (i32.sub (local.get $pairs) (i32.const 1)))
(br_if $loop (local.get $pairs))))
(func (export "quantize") (param $pairs i32) (param $p i32) (param $min f64) (param $inv f64)
(loop $loop
(v128.store (local.get $p) (f64x2.mul
 (f64x2.sub (v128.load (local.get $p)) (f64x2.splat (local.get $min)))
 (f64x2.splat (local.get $inv))))
(local.set $p (i32.add (local.get $p) (i32.const 16)))
(local.set $pairs (i32.sub (local.get $pairs) (i32.const 1)))
(br_if $loop (local.get $pairs)))))''')
