#!/usr/bin/env python3
"""
Construye EKO-RUMMY.apk sin el SDK de Android.

Escribe directamente:
  - classes.dex          Actividad mínima con un WebView que carga assets/index.html (Dalvik bytecode)
  - AndroidManifest.xml  en formato XML binario de Android (AXML)
  - resources.arsc       tabla de recursos con el ícono (res/drawable/icon.png)
y firma con jarsigner (esquema v1, SHA-256).

Uso: python3 build_apk.py <index.html> <icon.png> <keystore> <alias> <storepass> <salida.apk>
"""
import hashlib, struct, sys, zlib, zipfile, subprocess, os

PKG = 'com.businessshop.ekorummy'
CLS = 'Lcom/businessshop/ekorummy/Main;'
VERSION_CODE, VERSION_NAME = 1, '1.0.0'
MIN_SDK, TARGET_SDK = 21, 29

# ---------------------------------------------------------------- DEX

def uleb(n):
    out = bytearray()
    while True:
        b = n & 0x7f
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)

def mutf8(s):
    # MUTF-8: igual a UTF-8 para caracteres ASCII sin NUL (todo lo que usamos)
    assert all(0 < ord(c) < 0x80 for c in s)
    return s.encode('ascii')

def build_dex(url):
    T = {  # tipos
        'Activity': 'Landroid/app/Activity;', 'Context': 'Landroid/content/Context;', 'Bundle': 'Landroid/os/Bundle;',
        'View': 'Landroid/view/View;', 'WebSettings': 'Landroid/webkit/WebSettings;', 'WebView': 'Landroid/webkit/WebView;',
        'Main': CLS, 'String': 'Ljava/lang/String;', 'V': 'V', 'Z': 'Z', 'I': 'I',
    }
    # (clase, nombre, retorno, [parámetros])
    methods_spec = [
        ('Activity', '<init>', 'V', []),
        ('Activity', 'onCreate', 'V', ['Bundle']),
        ('Activity', 'onBackPressed', 'V', []),
        ('Activity', 'requestWindowFeature', 'Z', ['I']),
        ('Activity', 'setContentView', 'V', ['View']),
        ('WebView', '<init>', 'V', ['Context']),
        ('WebView', 'getSettings', 'WebSettings', []),
        ('WebView', 'loadUrl', 'V', ['String']),
        ('WebView', 'canGoBack', 'Z', []),
        ('WebView', 'goBack', 'V', []),
        ('WebSettings', 'setJavaScriptEnabled', 'V', ['Z']),
        ('WebSettings', 'setDomStorageEnabled', 'V', ['Z']),
        ('WebSettings', 'setMediaPlaybackRequiresUserGesture', 'V', ['Z']),
        ('Main', '<init>', 'V', []),
        ('Main', 'onCreate', 'V', ['Bundle']),
        ('Main', 'onBackPressed', 'V', []),
    ]
    field_spec = ('Main', 'WebView', 'w')

    def shorty_of(ret, params):
        f = lambda t: 'L' if T[t].startswith('L') else T[t]
        return f(ret) + ''.join(f(p) for p in params)

    strings = set(T.values())
    for c, n, r, p in methods_spec:
        strings.add(n); strings.add(shorty_of(r, p))
    strings.add(field_spec[2]); strings.add(url)
    # orden por puntos de código UTF-16 (ASCII = orden de bytes)
    strings = sorted(strings, key=lambda s: [ord(c) for c in s])
    sidx = {s: i for i, s in enumerate(strings)}
    types = sorted(set(T.values()), key=lambda d: sidx[d])
    tidx = {d: i for i, d in enumerate(types)}
    ty = lambda k: tidx[T[k]]

    protos = sorted({(ty(r), tuple(ty(x) for x in p), shorty_of(r, p)) for c, n, r, p in methods_spec},
                    key=lambda x: (x[0], x[1]))
    pidx = {(r, ps): i for i, (r, ps, _) in enumerate(protos)}
    mlist = sorted({(ty(c), sidx[n], pidx[(ty(r), tuple(ty(x) for x in p))]) for c, n, r, p in methods_spec},
                   key=lambda m: (m[0], m[1], m[2]))
    midx = {m: i for i, m in enumerate(mlist)}
    def M(c, n, r, p): return midx[(ty(c), sidx[n], pidx[(ty(r), tuple(ty(x) for x in p))])]
    fields = [(ty(field_spec[0]), ty(field_spec[1]), sidx[field_spec[2]])]
    F_W = 0

    # ---- bytecode
    def inv(op, regs, meth):
        n = len(regs)
        r = list(regs) + [0] * (5 - n)
        return [op | (n << 12) | (r[4] << 8), meth, r[0] | (r[1] << 4) | (r[2] << 8) | (r[3] << 12)]

    INV_VIRTUAL, INV_SUPER, INV_DIRECT = 0x6e, 0x6f, 0x70
    RETURN_VOID = [0x000e]

    m_act_init = M('Activity', '<init>', 'V', [])
    m_act_oncreate = M('Activity', 'onCreate', 'V', ['Bundle'])
    m_act_back = M('Activity', 'onBackPressed', 'V', [])
    m_req = M('Activity', 'requestWindowFeature', 'Z', ['I'])
    m_setcv = M('Activity', 'setContentView', 'V', ['View'])
    m_wv_init = M('WebView', '<init>', 'V', ['Context'])
    m_getset = M('WebView', 'getSettings', 'WebSettings', [])
    m_load = M('WebView', 'loadUrl', 'V', ['String'])
    m_canback = M('WebView', 'canGoBack', 'Z', [])
    m_goback = M('WebView', 'goBack', 'V', [])
    m_js = M('WebSettings', 'setJavaScriptEnabled', 'V', ['Z'])
    m_dom = M('WebSettings', 'setDomStorageEnabled', 'V', ['Z'])
    m_media = M('WebSettings', 'setMediaPlaybackRequiresUserGesture', 'V', ['Z'])

    # <init>()V   registros: v0 = this
    code_init = dict(regs=1, ins=1, outs=1, insns=inv(INV_DIRECT, [0], m_act_init) + RETURN_VOID)

    # onCreate(Bundle)V   v0 webview, v1 settings, v2 this, v3 bundle → luego constante
    oc = []
    oc += inv(INV_SUPER, [2, 3], m_act_oncreate)
    oc += [0x12 | (3 << 8) | (1 << 12)]                    # const/4 v3, #1
    oc += inv(INV_VIRTUAL, [2, 3], m_req)                  # requestWindowFeature(FEATURE_NO_TITLE=1)
    oc += [0x22 | (0 << 8), ty('WebView')]                 # new-instance v0, WebView
    oc += inv(INV_DIRECT, [0, 2], m_wv_init)               # WebView(this)
    oc += [0x5b | (0 << 8) | (2 << 12), F_W]               # iput-object v0, v2, Main.w
    oc += inv(INV_VIRTUAL, [0], m_getset)
    oc += [0x0c | (1 << 8)]                                # move-result-object v1
    oc += inv(INV_VIRTUAL, [1, 3], m_js)                   # setJavaScriptEnabled(true)
    oc += inv(INV_VIRTUAL, [1, 3], m_dom)                  # setDomStorageEnabled(true)
    oc += [0x12 | (3 << 8) | (0 << 12)]                    # const/4 v3, #0
    oc += inv(INV_VIRTUAL, [1, 3], m_media)                # setMediaPlaybackRequiresUserGesture(false)
    oc += inv(INV_VIRTUAL, [2, 0], m_setcv)                # setContentView(webview)
    oc += [0x1a | (1 << 8), sidx[url]]                     # const-string v1, url
    oc += inv(INV_VIRTUAL, [0, 1], m_load)                 # loadUrl(url)
    oc += RETURN_VOID
    code_oncreate = dict(regs=4, ins=2, outs=2, insns=oc)

    # onBackPressed()V   v0 webview, v1 bool, v2 this
    ob = []
    ob += [0x54 | (0 << 8) | (2 << 12), F_W]               # 0: iget-object v0, v2, Main.w
    ob += [0x38 | (0 << 8), 12]                            # 2: if-eqz v0, +12 → 14
    ob += inv(INV_VIRTUAL, [0], m_canback)                 # 4
    ob += [0x0a | (1 << 8)]                                # 7: move-result v1
    ob += [0x38 | (1 << 8), 6]                             # 8: if-eqz v1, +6 → 14
    ob += inv(INV_VIRTUAL, [0], m_goback)                  # 10
    ob += RETURN_VOID                                      # 13
    ob += inv(INV_SUPER, [2], m_act_back)                  # 14
    ob += RETURN_VOID                                      # 17
    code_back = dict(regs=3, ins=1, outs=1, insns=ob)

    # ---- disposición del archivo
    HEADER = 0x70
    off = HEADER
    string_ids_off = off; off += 4 * len(strings)
    type_ids_off = off; off += 4 * len(types)
    proto_ids_off = off; off += 12 * len(protos)
    field_ids_off = off; off += 8 * len(fields)
    method_ids_off = off; off += 8 * len(mlist)
    class_defs_off = off; off += 32
    data_off = off

    data = bytearray()
    def align(n):
        while (data_off + len(data)) % n:
            data.append(0)
    # type_lists (parámetros)
    tl_off = {}
    for r, ps, _ in protos:
        if ps and ps not in tl_off:
            align(4)
            tl_off[ps] = data_off + len(data)
            data += struct.pack('<I', len(ps)) + b''.join(struct.pack('<H', p) for p in ps)
    type_list_count = len(tl_off)
    type_list_start = min(tl_off.values()) if tl_off else 0
    # código
    align(4)
    code_start = data_off + len(data)
    code_off = {}
    for name, c in (('init', code_init), ('oncreate', code_oncreate), ('back', code_back)):
        align(4)
        code_off[name] = data_off + len(data)
        data += struct.pack('<HHHHII', c['regs'], c['ins'], c['outs'], 0, 0, len(c['insns']))
        data += b''.join(struct.pack('<H', u) for u in c['insns'])
    # string_data
    string_data_start = data_off + len(data)
    sdata_off = []
    for s in strings:
        sdata_off.append(data_off + len(data))
        data += uleb(len(s)) + mutf8(s) + b'\x00'
    # class_data
    class_data_off = data_off + len(data)
    m_main_init = M('Main', '<init>', 'V', [])
    m_main_oncreate = M('Main', 'onCreate', 'V', ['Bundle'])
    m_main_back = M('Main', 'onBackPressed', 'V', [])
    virt = sorted([(m_main_oncreate, 0x4, code_off['oncreate']), (m_main_back, 0x1, code_off['back'])])
    cd = uleb(0) + uleb(1) + uleb(1) + uleb(len(virt))
    cd += uleb(F_W) + uleb(0x2)                                   # private WebView w
    cd += uleb(m_main_init) + uleb(0x10001) + uleb(code_off['init'])  # public constructor
    prev = 0
    for m, acc, co in virt:
        cd += uleb(m - prev) + uleb(acc) + uleb(co)
        prev = m
    data += cd
    # map_list
    align(4)
    map_off = data_off + len(data)
    items = [
        (0x0000, 1, 0), (0x0001, len(strings), string_ids_off), (0x0002, len(types), type_ids_off),
        (0x0003, len(protos), proto_ids_off), (0x0004, len(fields), field_ids_off), (0x0005, len(mlist), method_ids_off),
        (0x0006, 1, class_defs_off),
    ]
    if type_list_count:
        items.append((0x1001, type_list_count, type_list_start))
    items += [(0x2001, 3, code_start), (0x2002, len(strings), string_data_start), (0x2000, 1, class_data_off), (0x1000, 1, map_off)]
    items.sort(key=lambda x: x[2])
    data += struct.pack('<I', len(items)) + b''.join(struct.pack('<HHII', t, 0, n, o) for t, n, o in items)

    out = bytearray(HEADER)
    out += b''.join(struct.pack('<I', o) for o in sdata_off)
    out += b''.join(struct.pack('<I', sidx[t]) for t in types)
    for r, ps, shorty in protos:
        out += struct.pack('<III', sidx[shorty], r, tl_off.get(ps, 0) if ps else 0)
    for c, t, n in fields:
        out += struct.pack('<HHI', c, t, n)
    for c, n, p in mlist:
        out += struct.pack('<HHI', c, p, n)
    out += struct.pack('<IIIIIIII', ty('Main'), 0x1, ty('Activity'), 0, 0xffffffff, 0, class_data_off, 0)
    assert len(out) == data_off
    out += data
    file_size = len(out)
    struct.pack_into('<8s', out, 0, b'dex\n035\x00')
    struct.pack_into('<I', out, 32, file_size)
    struct.pack_into('<I', out, 36, HEADER)
    struct.pack_into('<I', out, 40, 0x12345678)
    struct.pack_into('<II', out, 44, 0, 0)
    struct.pack_into('<I', out, 52, map_off)
    struct.pack_into('<II', out, 56, len(strings), string_ids_off)
    struct.pack_into('<II', out, 64, len(types), type_ids_off)
    struct.pack_into('<II', out, 72, len(protos), proto_ids_off)
    struct.pack_into('<II', out, 80, len(fields), field_ids_off)
    struct.pack_into('<II', out, 88, len(mlist), method_ids_off)
    struct.pack_into('<II', out, 96, 1, class_defs_off)
    struct.pack_into('<II', out, 104, file_size - data_off, data_off)
    out[12:32] = hashlib.sha1(bytes(out[32:])).digest()
    struct.pack_into('<I', out, 8, zlib.adler32(bytes(out[12:])) & 0xffffffff)
    return bytes(out)

# ---------------------------------------------------------------- AXML

class StringPool:
    def __init__(self, strings):
        self.strings = list(strings)
    def encode(self):
        data = bytearray(); offs = []
        for s in self.strings:
            offs.append(len(data))
            u = s.encode('utf-16-le')
            data += struct.pack('<H', len(s)) + u + b'\x00\x00'
        while len(data) % 4: data.append(0)
        hdr = 28
        strings_start = hdr + 4 * len(offs)
        size = strings_start + len(data)
        return struct.pack('<HHIIIIII', 0x0001, hdr, size, len(offs), 0, 0, strings_start, 0) + b''.join(struct.pack('<I', o) for o in offs) + bytes(data)

ANDROID_NS = 'http://schemas.android.com/apk/res/android'
ATTR_IDS = {  # android.R.attr
    'label': 0x01010001, 'icon': 0x01010002, 'name': 0x01010003, 'configChanges': 0x0101001f,
    'minSdkVersion': 0x0101020c, 'versionCode': 0x0101021b, 'versionName': 0x0101021c, 'targetSdkVersion': 0x01010270,
}
T_REF, T_STRING, T_INT_DEC, T_INT_HEX, T_BOOL = 0x01, 0x03, 0x10, 0x11, 0x12

def build_axml(tree):
    # tree: (tag, [(ns_android?, name, type, value)], [children])
    attr_names = []
    others = []
    def collect(node):
        tag, attrs, kids = node
        others.append(tag)
        for android, name, t, v in attrs:
            if android:
                if name not in attr_names: attr_names.append(name)
            else:
                others.append(name)
            if t == T_STRING: others.append(v)
        for k in kids: collect(k)
    collect(tree)
    attr_names.sort(key=lambda n: ATTR_IDS[n])
    pool = list(attr_names)
    for s in ['android', ANDROID_NS] + others:
        if s not in pool: pool.append(s)
    si = {s: i for i, s in enumerate(pool)}
    body = bytearray()
    body += StringPool(pool).encode()
    resmap = b''.join(struct.pack('<I', ATTR_IDS[n]) for n in attr_names)
    body += struct.pack('<HHI', 0x0180, 8, 8 + len(resmap)) + resmap
    NONE = 0xffffffff
    body += struct.pack('<HHIII', 0x0100, 16, 24, 1, NONE) + struct.pack('<II', si['android'], si[ANDROID_NS])
    def emit(node):
        tag, attrs, kids = node
        enc = []
        for android, name, t, v in sorted(attrs, key=lambda a: ATTR_IDS.get(a[1], 0) if a[0] else 0):
            ns = si[ANDROID_NS] if android else NONE
            if t == T_STRING:
                raw, data = si[v], si[v]
            else:
                raw, data = NONE, v
            enc.append(struct.pack('<IIIHBBI', ns, si[name], raw, 8, 0, t, data & 0xffffffff))
        ext = struct.pack('<IIHHHHHH', NONE, si[tag], 20, 20, len(enc), 0, 0, 0)
        chunk = ext + b''.join(enc)
        body.extend(struct.pack('<HHIII', 0x0102, 16, 16 + len(chunk), 1, NONE) + chunk)
        for k in kids: emit(k)
        body.extend(struct.pack('<HHIII', 0x0103, 16, 24, 1, NONE) + struct.pack('<II', NONE, si[tag]))
    emit(tree)
    body += struct.pack('<HHIII', 0x0101, 16, 24, 1, NONE) + struct.pack('<II', si['android'], si[ANDROID_NS])
    return struct.pack('<HHI', 0x0003, 8, 8 + len(body)) + bytes(body)

def manifest():
    A = True
    return ('manifest', [(False, 'package', T_STRING, PKG), (A, 'versionCode', T_INT_DEC, VERSION_CODE), (A, 'versionName', T_STRING, VERSION_NAME)], [
        ('uses-sdk', [(A, 'minSdkVersion', T_INT_DEC, MIN_SDK), (A, 'targetSdkVersion', T_INT_DEC, TARGET_SDK)], []),
        ('uses-permission', [(A, 'name', T_STRING, 'android.permission.INTERNET')], []),
        ('application', [(A, 'label', T_STRING, 'EKO RUMMY'), (A, 'icon', T_REF, 0x7f010000)], [
            ('activity', [(A, 'name', T_STRING, PKG + '.Main'), (A, 'label', T_STRING, 'EKO RUMMY'),
                          (A, 'configChanges', T_INT_HEX, 0x0DA0)], [  # orientation|keyboardHidden|screenSize|smallestScreenSize|screenLayout
                ('intent-filter', [], [
                    ('action', [(A, 'name', T_STRING, 'android.intent.action.MAIN')], []),
                    ('category', [(A, 'name', T_STRING, 'android.intent.category.LAUNCHER')], []),
                ]),
            ]),
        ]),
    ])

# ---------------------------------------------------------------- resources.arsc

def build_arsc(icon_path):
    gpool = StringPool([icon_path]).encode()
    type_pool = StringPool(['drawable']).encode()
    key_pool = StringPool(['icon']).encode()
    spec = struct.pack('<HHIBBHI', 0x0202, 16, 16 + 4, 1, 0, 0, 1) + struct.pack('<I', 0)
    config = struct.pack('<I', 64) + bytes(60)
    type_hdr_size = 8 + 1 + 1 + 2 + 4 + 4 + len(config)
    entries_start = type_hdr_size + 4
    entry = struct.pack('<HHI', 8, 0, 0) + struct.pack('<HBBI', 8, 0, T_STRING, 0)
    tchunk = struct.pack('<HHIBBHII', 0x0201, type_hdr_size, entries_start + len(entry), 1, 0, 0, 1, entries_start) + config + struct.pack('<I', 0) + entry
    name = PKG.encode('utf-16-le').ljust(256, b'\x00')
    pkg_hdr = 288
    type_strings_off = pkg_hdr
    key_strings_off = pkg_hdr + len(type_pool)
    pkg_body = type_pool + key_pool + spec + tchunk
    pkg = struct.pack('<HHII', 0x0200, pkg_hdr, pkg_hdr + len(pkg_body), 0x7f) + name + struct.pack('<IIIII', type_strings_off, 1, key_strings_off, 1, 0) + pkg_body
    body = gpool + pkg
    return struct.pack('<HHII', 0x0002, 12, 12 + len(body), 1) + body

# ---------------------------------------------------------------- empaquetado

def main():
    html, icon, keystore, alias, storepass, out = sys.argv[1:7]
    url = 'file:///android_asset/index.html'
    unsigned = out + '.unsigned'
    with zipfile.ZipFile(unsigned, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('AndroidManifest.xml', build_axml(manifest()))
        z.writestr('classes.dex', build_dex(url))
        z.writestr(zipfile.ZipInfo('resources.arsc'), build_arsc('res/drawable/icon.png'), compress_type=zipfile.ZIP_STORED)
        z.write(icon, 'res/drawable/icon.png', compress_type=zipfile.ZIP_STORED)
        z.write(html, 'assets/index.html')
    subprocess.run(['jarsigner', '-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', '-keystore', keystore, '-storepass', storepass,
                    '-signedjar', out, unsigned, alias], check=True, stdout=subprocess.DEVNULL)
    os.remove(unsigned)
    print('APK:', out, os.path.getsize(out), 'bytes')

if __name__ == '__main__':
    main()
