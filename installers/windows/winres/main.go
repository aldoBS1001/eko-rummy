// Genera un archivo .syso (objeto COFF con sección .rsrc) con el ícono y el manifiesto de la app,
// para que el ejecutable de Windows muestre el ícono de EKO RUMMY. Sin dependencias externas.
//
// Uso: go run ./winres <icono.ico> <manifest.xml> <salida.syso>
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"sort"
)

type icoEntry struct {
	w, h, colors, reserved byte
	planes, bitcount       uint16
	data                   []byte
}

func readICO(path string) []icoEntry {
	b, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	n := int(binary.LittleEndian.Uint16(b[4:]))
	out := make([]icoEntry, n)
	for i := 0; i < n; i++ {
		e := b[6+16*i:]
		size := binary.LittleEndian.Uint32(e[8:])
		off := binary.LittleEndian.Uint32(e[12:])
		out[i] = icoEntry{e[0], e[1], e[2], e[3], binary.LittleEndian.Uint16(e[4:]), binary.LittleEndian.Uint16(e[6:]), b[off : off+size]}
	}
	return out
}

type res struct {
	typ, id uint32
	lang    uint32
	data    []byte
}

func main() {
	if len(os.Args) != 4 {
		fmt.Println("uso: winres icono.ico manifest.xml salida.syso")
		os.Exit(2)
	}
	icons := readICO(os.Args[1])
	manifest, err := os.ReadFile(os.Args[2])
	if err != nil {
		panic(err)
	}
	const lang = 0x0409
	var list []res
	grp := new(bytes.Buffer)
	binary.Write(grp, binary.LittleEndian, []uint16{0, 1, uint16(len(icons))})
	for i, ic := range icons {
		id := uint32(i + 1)
		list = append(list, res{3, id, lang, ic.data}) // RT_ICON
		grp.Write([]byte{ic.w, ic.h, ic.colors, ic.reserved})
		binary.Write(grp, binary.LittleEndian, ic.planes)
		binary.Write(grp, binary.LittleEndian, ic.bitcount)
		binary.Write(grp, binary.LittleEndian, uint32(len(ic.data)))
		binary.Write(grp, binary.LittleEndian, uint16(id))
	}
	list = append(list, res{14, 1, lang, grp.Bytes()}) // RT_GROUP_ICON
	list = append(list, res{24, 1, lang, manifest})    // RT_MANIFEST
	sort.Slice(list, func(i, j int) bool {
		if list[i].typ != list[j].typ {
			return list[i].typ < list[j].typ
		}
		return list[i].id < list[j].id
	})

	// Agrupar por tipo
	types := []uint32{}
	byType := map[uint32][]res{}
	for _, r := range list {
		if _, ok := byType[r.typ]; !ok {
			types = append(types, r.typ)
		}
		byType[r.typ] = append(byType[r.typ], r)
	}

	// Calcular tamaños: raíz, directorios de tipo, directorios de id (cada uno con 1 idioma), entradas de datos, datos
	dirSize := func(n int) int { return 16 + 8*n }
	off := dirSize(len(types))
	typeDirOff := map[uint32]int{}
	for _, t := range types {
		typeDirOff[t] = off
		off += dirSize(len(byType[t]))
	}
	idDirOff := make([]int, len(list))
	for i := range list {
		idDirOff[i] = off
		off += dirSize(1)
	}
	dataEntryOff := make([]int, len(list))
	for i := range list {
		dataEntryOff[i] = off
		off += 16
	}
	dataOff := make([]int, len(list))
	for i, r := range list {
		off = (off + 7) &^ 7
		dataOff[i] = off
		off += len(r.data)
	}
	sec := make([]byte, (off+7)&^7)
	le := binary.LittleEndian
	writeDir := func(at int, n int) {
		le.PutUint16(sec[at+14:], uint16(n)) // NumberOfIdEntries
	}
	writeDir(0, len(types))
	for i, t := range types {
		le.PutUint32(sec[16+8*i:], t)
		le.PutUint32(sec[16+8*i+4:], uint32(typeDirOff[t])|0x80000000)
	}
	idx := 0
	for _, t := range types {
		rs := byType[t]
		writeDir(typeDirOff[t], len(rs))
		for j, r := range rs {
			e := typeDirOff[t] + 16 + 8*j
			le.PutUint32(sec[e:], r.id)
			le.PutUint32(sec[e+4:], uint32(idDirOff[idx])|0x80000000)
			writeDir(idDirOff[idx], 1)
			le.PutUint32(sec[idDirOff[idx]+16:], r.lang)
			le.PutUint32(sec[idDirOff[idx]+20:], uint32(dataEntryOff[idx]))
			idx++
		}
	}
	var relocs []uint32
	for i, r := range list {
		de := dataEntryOff[i]
		le.PutUint32(sec[de:], uint32(dataOff[i])) // RVA relativa a la sección; el enlazador la reubica
		le.PutUint32(sec[de+4:], uint32(len(r.data)))
		relocs = append(relocs, uint32(de))
		copy(sec[dataOff[i]:], r.data)
	}

	// Objeto COFF
	const hdr, sh = 20, 40
	rawPtr := hdr + sh
	relocPtr := rawPtr + len(sec)
	symPtr := relocPtr + 10*len(relocs)
	out := new(bytes.Buffer)
	binary.Write(out, le, uint16(0x8664)) // AMD64
	binary.Write(out, le, uint16(1))
	binary.Write(out, le, uint32(0))
	binary.Write(out, le, uint32(symPtr))
	binary.Write(out, le, uint32(1))
	binary.Write(out, le, uint16(0))
	binary.Write(out, le, uint16(0))
	out.Write([]byte(".rsrc\x00\x00\x00"))
	binary.Write(out, le, uint32(0))
	binary.Write(out, le, uint32(0))
	binary.Write(out, le, uint32(len(sec)))
	binary.Write(out, le, uint32(rawPtr))
	binary.Write(out, le, uint32(relocPtr))
	binary.Write(out, le, uint32(0))
	binary.Write(out, le, uint16(len(relocs)))
	binary.Write(out, le, uint16(0))
	binary.Write(out, le, uint32(0x40000040)) // INITIALIZED_DATA | MEM_READ
	out.Write(sec)
	for _, r := range relocs {
		binary.Write(out, le, r)
		binary.Write(out, le, uint32(0)) // símbolo 0 (.rsrc)
		binary.Write(out, le, uint16(3)) // IMAGE_REL_AMD64_ADDR32NB
	}
	out.Write([]byte(".rsrc\x00\x00\x00"))
	binary.Write(out, le, uint32(0))
	binary.Write(out, le, uint16(1))
	binary.Write(out, le, uint16(0))
	out.Write([]byte{3, 0}) // IMAGE_SYM_CLASS_STATIC, sin auxiliares
	binary.Write(out, le, uint32(4)) // tabla de cadenas vacía
	if err := os.WriteFile(os.Args[3], out.Bytes(), 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("syso: %d recursos, %d bytes\n", len(list), out.Len())
}
