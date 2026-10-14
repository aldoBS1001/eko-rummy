#!/usr/bin/env python3
"""Verificación independiente del APK: lee el DEX, el manifiesto binario y la tabla de recursos
desde cero (sin reutilizar el código que los genera) y comprueba las reglas del formato."""
import hashlib, struct, sys, zlib, zipfile

errors = []
def check(cond, msg):
    if not cond: errors.append(msg)

def read_uleb(b, o):
    r = s = 0
    while True:
        x = b[o]; o += 1
        r |= (x & 0x7f) << s; s += 7
        if not x & 0x80: return r, o

def dex(b):
    print('== classes.dex')
    check(b[:8] == b'dex\n035\x00', 'magic')
    check(struct.unpack_from('<I', b, 8)[0] == zlib.adler32(b[12:]) & 0xffffffff, 'checksum adler32')
    check(b[12:32] == hashlib.sha1(b[32:]).digest(), 'firma SHA-1')
    (fsize, hsize, endian, lsz, loff, mapoff, sn, so, tn, to, pn, po, fn, fo, mn, mo, cn, co, dsz, doff) = struct.unpack_from('<20I', b, 32)
    check(fsize == len(b), 'file_size'); check(hsize == 0x70, 'header_size'); check(endian == 0x12345678, 'endian')
    check(doff + dsz == len(b), 'data section hasta el final')
    def string(i):
        off = struct.unpack_from('<I', b, so + 4 * i)[0]
        n, o = read_uleb(b, off)
        end = b.index(0, o)
        s = b[o:end].decode('utf-8'); check(len(s) == n, f'longitud de cadena {s}')
        return s
    strings = [string(i) for i in range(sn)]
    check(strings == sorted(strings), 'cadenas ordenadas')
    types = [strings[struct.unpack_from('<I', b, to + 4 * i)[0]] for i in range(tn)]
    tids = [struct.unpack_from('<I', b, to + 4 * i)[0] for i in range(tn)]
    check(tids == sorted(tids) and len(set(tids)) == len(tids), 'type_ids ordenados')
    def tlist(off):
        if not off: return []
        check(off % 4 == 0, 'type_list alineado')
        n = struct.unpack_from('<I', b, off)[0]
        return [struct.unpack_from('<H', b, off + 4 + 2 * i)[0] for i in range(n)]
    protos = []
    for i in range(pn):
        sh, rt, poff = struct.unpack_from('<III', b, po + 12 * i)
        params = tlist(poff)
        protos.append((rt, params))
        expected = ''.join('L' if types[t][0] in 'L[' else types[t] for t in [rt] + params)
        check(strings[sh] == expected, f'shorty {strings[sh]} != {expected}')
    check(protos == sorted(protos), 'proto_ids ordenados')
    fields = [struct.unpack_from('<HHI', b, fo + 8 * i) for i in range(fn)]
    meths = [struct.unpack_from('<HHI', b, mo + 8 * i) for i in range(mn)]
    check([(c, n, p) for c, p, n in meths] == sorted((c, n, p) for c, p, n in meths), 'method_ids ordenados')
    def mname(i):
        c, p, n = meths[i]; rt, ps = protos[p]
        return f"{types[c]}->{strings[n]}({''.join(types[x] for x in ps)}){types[rt]}"
    def fname(i):
        c, t, n = fields[i]; return f"{types[c]}->{strings[n]}:{types[t]}"
    for i in range(cn):
        cls, acc, sup, itf, src, ann, cdo, sv = struct.unpack_from('<8I', b, co + 32 * i)
        print(f'clase {types[cls]} extends {types[sup]} (acceso {acc:#x})')
        o = cdo
        sf, o = read_uleb(b, o); inf, o = read_uleb(b, o); dm, o = read_uleb(b, o); vm, o = read_uleb(b, o)
        idx = 0
        for _ in range(sf + inf):
            d, o = read_uleb(b, o); a, o = read_uleb(b, o); idx += d
            print(f'  campo {fname(idx)} acceso {a:#x}')
        for group, count in (('directo', dm), ('virtual', vm)):
            idx = 0
            for _ in range(count):
                d, o = read_uleb(b, o); a, o = read_uleb(b, o); code, o = read_uleb(b, o); idx += d
                print(f'  método {group} {mname(idx)} acceso {a:#x}')
                disasm(b, code, strings, types, mname, fname, protos, meths)

def disasm(b, off, strings, types, mname, fname, protos, meths):
    check(off % 4 == 0, 'code_item alineado')
    regs, ins, outs, tries, dbg, n = struct.unpack_from('<HHHHII', b, off)
    u = [struct.unpack_from('<H', b, off + 16 + 2 * i)[0] for i in range(n)]
    print(f'    registros={regs} entrada={ins} salida={outs}')
    check(ins <= regs, 'ins <= registros')
    pc = 0
    while pc < n:
        w = u[pc]; op = w & 0xff
        def reg_ok(r): check(r < regs, f'registro v{r} fuera de rango en pc {pc}')
        if op in (0x6e, 0x6f, 0x70):
            a = w >> 12; g = (w >> 8) & 0xf; m = u[pc + 1]; cdef = u[pc + 2]
            rr = [cdef & 0xf, (cdef >> 4) & 0xf, (cdef >> 8) & 0xf, (cdef >> 12) & 0xf, g][:a]
            for r in rr: reg_ok(r)
            check(a <= outs, f'outs insuficientes en pc {pc}')
            _, p, _ = meths[m]; rt, ps = protos[p]
            nargs = len(ps) + 1  # métodos de instancia
            check(a == nargs, f'aridad {a} != {nargs} en {mname(m)}')
            name = {0x6e: 'invoke-virtual', 0x6f: 'invoke-super', 0x70: 'invoke-direct'}[op]
            print(f'    {pc:3}: {name} {{{", ".join("v%d" % r for r in rr)}}}, {mname(m)}'); pc += 3
        elif op == 0x0e: print(f'    {pc:3}: return-void'); pc += 1
        elif op == 0x12:
            a = (w >> 8) & 0xf; lit = w >> 12; reg_ok(a); print(f'    {pc:3}: const/4 v{a}, #{lit}'); pc += 1
        elif op == 0x22:
            a = w >> 8; reg_ok(a); print(f'    {pc:3}: new-instance v{a}, {types[u[pc+1]]}'); pc += 2
        elif op == 0x1a:
            a = w >> 8; reg_ok(a); print(f'    {pc:3}: const-string v{a}, "{strings[u[pc+1]]}"'); pc += 2
        elif op in (0x5b, 0x54):
            a = (w >> 8) & 0xf; bb = w >> 12; reg_ok(a); reg_ok(bb)
            print(f'    {pc:3}: {"iput-object" if op == 0x5b else "iget-object"} v{a}, v{bb}, {fname(u[pc+1])}'); pc += 2
        elif op in (0x0c, 0x0a):
            a = w >> 8; reg_ok(a); print(f'    {pc:3}: {"move-result-object" if op == 0x0c else "move-result"} v{a}'); pc += 1
        elif op == 0x38:
            a = w >> 8; t = struct.unpack('<h', struct.pack('<H', u[pc+1]))[0]; reg_ok(a)
            check(0 <= pc + t < n, f'salto fuera del método en pc {pc}')
            print(f'    {pc:3}: if-eqz v{a}, -> {pc + t}'); pc += 2
        else:
            errors.append(f'opcode desconocido {op:#x} en pc {pc}'); return
    check(pc == n, 'fin de instrucciones exacto')

def axml(b):
    print('== AndroidManifest.xml (decodificado)')
    t, hs, size = struct.unpack_from('<HHI', b, 0)
    check(t == 0x0003 and size == len(b), 'cabecera AXML')
    o = 8; pool = []; resmap = []; depth = 0
    while o < len(b):
        t, hs, size = struct.unpack_from('<HHI', b, o)
        check(size > 0 and o + size <= len(b), f'tamaño de bloque en {o}')
        if t == 0x0001:
            cnt, styles, flags, start, sstart = struct.unpack_from('<IIIII', b, o + 8)
            for i in range(cnt):
                so = struct.unpack_from('<I', b, o + hs + 4 * i)[0]
                p = o + start + so
                n = struct.unpack_from('<H', b, p)[0]
                pool.append(b[p + 2:p + 2 + 2 * n].decode('utf-16-le'))
                check(b[p + 2 + 2 * n:p + 4 + 2 * n] == b'\x00\x00', 'terminador de cadena')
        elif t == 0x0180:
            resmap = [struct.unpack_from('<I', b, o + 8 + 4 * i)[0] for i in range((size - 8) // 4)]
        elif t == 0x0102:
            ns, name, ast, asz, cnt = struct.unpack_from('<IIHHH', b, o + 16)
            check(ast == 20 and asz == 20, 'tamaños de atributo')
            attrs = []
            for i in range(cnt):
                ans, an, raw, vs, r0, dt, data = struct.unpack_from('<IIIHBBI', b, o + 16 + ast + 20 * i)
                check(vs == 8, 'Res_value size')
                rid = resmap[an] if an < len(resmap) else None
                pre = 'android:' if ans != 0xffffffff else ''
                val = pool[data] if dt == 3 else (f'@{data:#010x}' if dt == 1 else (f'{data:#x}' if dt == 0x11 else str(data)))
                attrs.append(f'{pre}{pool[an]}="{val}"' + (f' [{rid:#010x}]' if rid else ''))
                if ans != 0xffffffff: check(rid is not None, f'atributo android sin id de recurso: {pool[an]}')
            print('  ' * depth + f'<{pool[name]} ' + ' '.join(attrs) + '>')
            depth += 1
        elif t == 0x0103:
            depth -= 1
        o += size
    check(depth == 0, 'elementos balanceados')

def arsc(b):
    print('== resources.arsc')
    t, hs, size, pkgs = struct.unpack_from('<HHII', b, 0)
    check(t == 2 and hs == 12 and size == len(b) and pkgs == 1, 'cabecera de tabla')
    o = 12
    t, hs, size = struct.unpack_from('<HHI', b, o)
    cnt, _, _, start, _ = struct.unpack_from('<IIIII', b, o + 8)
    so = struct.unpack_from('<I', b, o + hs)[0]; p = o + start + so; n = struct.unpack_from('<H', b, p)[0]
    gstr = b[p + 2:p + 2 + 2 * n].decode('utf-16-le')
    o += size
    t, hs, size, pid = struct.unpack_from('<HHII', b, o)
    name = b[o + 12:o + 268].decode('utf-16-le').rstrip('\x00')
    check(t == 0x0200 and hs == 288 and pid == 0x7f, 'paquete')
    po = o; o += hs
    seen = []
    while o < po + size:
        t, h2, s2 = struct.unpack_from('<HHI', b, o)
        seen.append(t)
        if t == 0x0201:
            tid, _, _, ec, es = struct.unpack_from('<BBHII', b, o + 8)
            eoff = struct.unpack_from('<I', b, o + h2)[0]
            esz, ef, key = struct.unpack_from('<HHI', b, o + es + eoff)
            vsz, _, dt, data = struct.unpack_from('<HBBI', b, o + es + eoff + 8)
            print(f'  recurso 0x7f{tid:02x}0000 ({name}) → {gstr if dt == 3 and data == 0 else data}')
            check(dt == 3 and data == 0, 'valor del ícono')
        o += s2
    check(seen == [0x0001, 0x0001, 0x0202, 0x0201], f'bloques del paquete {seen}')

z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
for req in ['AndroidManifest.xml', 'classes.dex', 'resources.arsc', 'res/drawable/icon.png', 'assets/index.html', 'META-INF/MANIFEST.MF']:
    check(req in names, f'falta {req}')
dex(z.read('classes.dex'))
axml(z.read('AndroidManifest.xml'))
arsc(z.read('resources.arsc'))
check(z.read('res/drawable/icon.png')[:8] == b'\x89PNG\r\n\x1a\n', 'ícono PNG')
html = z.read('assets/index.html').decode()
check(html.startswith('<!doctype html>') and '<div id="app"></div>' in html and '<script type="module">' in html, 'HTML del juego')
print('\nERRORES:' if errors else '\nSin errores de formato.', *errors, sep='\n  ')
sys.exit(1 if errors else 0)
