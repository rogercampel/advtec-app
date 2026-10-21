"""Bateria de mutação do portão da OAB.

Apaga a regra, roda o teste, confere que ele ACUSA. Regra que pode sumir com a
suíte verde é regra sem cobertura — e o teste que a "cobria" é enfeite.

Duas partes:
  A. cada linha de REGRAS, uma a uma, descoberta por varredura (não por lista
     escrita à mão, que foi como a primeira versão se enganou e afirmou cobrir
     famílias inteiras testando uma regra de cada);
  B. as guardas estruturais, que não são linhas de REGRAS.

Guarda o original em memória e restaura no `finally`. A primeira versão morreu
numa exceção de encoding e deixou o código mutado no disco.
"""

import io
import re
import subprocess
import sys

P = "lib/oab/travas.ts"  # rode da raiz do repositorio: python scripts/mutar-travas-oab.py
TESTE = "tests/unit/oab-travas.test.ts"

ESTRUTURAIS = [
    ("normalizacao de acento", r'.replace(/\p{Diacritic}/gu, "")', ""),
    (
        "camada 1 (perguntaDeMerito)",
        "if (perguntaDeMerito(mensagemDoCliente) && !defereAoAdvogado(respostaCandidata)) {",
        "if (false) {",
    ),
    ("allowlist de deferencia", "&& !defereAoAdvogado(respostaCandidata)", ""),
    ("guarda de eco", "if (ECO.test(t) && !primeiraPessoa) return false;", ""),
    (
        "guarda de mensagem vazia",
        'if (normalizaParaCasar(mensagemDoCliente) === "") {',
        "if (false) {",
    ),
    ("porta de saida humana", "if (pedeHumano(mensagemDoCliente)) {", "if (false) {"),
]


def roda():
    r = subprocess.run(
        ["pnpm", "exec", "vitest", "run", TESTE],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=True,
    )
    out = (r.stdout or "") + (r.stderr or "")
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    if not m:
        return None
    return int(m.group(1)) if m.group(1) else 0


orig = io.open(P, encoding="utf-8").read()
linhas = orig.split("\n")

# Descobre as regras varrendo o arquivo, em vez de confiar numa lista minha.
regras = [
    (i, ln.strip())
    for i, ln in enumerate(linhas)
    if ln.strip().startswith('{ motivo: "') and ln.strip().endswith("},")
]

sobreviventes = []
try:
    base = roda()
    print(f"sem mutacao: {base} falha(s)  <- tem de ser 0")
    print(f"\nA. as {len(regras)} regras de REGRAS, uma a uma")
    print("-" * 78)
    for i, texto in regras:
        mut = linhas[:i] + linhas[i + 1 :]
        io.open(P, "w", encoding="utf-8", newline="\n").write("\n".join(mut))
        f = roda()
        rotulo = texto.split('padrao: ')[-1][:52]
        if f:
            print(f"  ok  {rotulo:54} vermelho em {f}")
        else:
            print(f"  >>  {rotulo:54} SOBREVIVEU")
            sobreviventes.append(rotulo)

    print("\nB. as guardas estruturais")
    print("-" * 78)
    for nome, alvo, subst in ESTRUTURAIS:
        if alvo not in orig:
            print(f"  ??  {nome:54} ALVO NAO ACHADO")
            sobreviventes.append(nome)
            continue
        io.open(P, "w", encoding="utf-8", newline="\n").write(orig.replace(alvo, subst, 1))
        f = roda()
        if f:
            print(f"  ok  {nome:54} vermelho em {f}")
        else:
            print(f"  >>  {nome:54} SOBREVIVEU")
            sobreviventes.append(nome)
finally:
    io.open(P, "w", encoding="utf-8", newline="\n").write(orig)

print(f"\ncodigo restaurado. mutacoes SEM acusacao: {len(sobreviventes)}")
for s in sobreviventes:
    print("  -", s)
sys.exit(1 if sobreviventes else 0)
