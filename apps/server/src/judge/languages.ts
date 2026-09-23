import { spawnSync } from 'node:child_process';
import { bitsIncludeDir } from './compat.js';

export interface LanguageDef {
  id: string;
  name: string;
  extension: string;
  /** File name the source is written to. */
  sourceFile: string;
  /** Binary/entry point produced by the compiler (relative to the sandbox dir). */
  artifact?: string;
  /** Compile command. `mem` is the memory limit in MB. */
  compile?: (opts: { memMb: number }) => { cmd: string; args: string[] };
  /** Run command. */
  run: () => { cmd: string; args: string[] };
  /** Extra wall-clock time allowance for interpreter/VM startup (ms). */
  startupGraceMs: number;
  /** Multiplier applied to the problem time limit. */
  timeMultiplier: number;
  /** Baseline memory overhead in KB counted towards the problem memory limit. */
  memoryOverheadKb: number;
  /** E.g. Java text classes need the class name to match the file. */
  classStyle?: boolean;
  /** Tools that must exist on PATH for the language to be selectable. */
  requires: string[];
  /** CodeMirror language id used by the frontend editor. */
  editor: string;
  template?: string;
  enabledByDefault?: boolean;
}

function firstAvailable(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (hasBinary(candidate)) return candidate;
  }
  return null;
}

export function hasBinary(bin: string): boolean {
  const result = spawnSync('/bin/sh', ['-c', `command -v ${JSON.stringify(bin)}`], {
    encoding: 'utf8',
  });
  return result.status === 0 && Boolean(result.stdout?.trim());
}

/** Extra `-I` arguments required so that `<bits/stdc++.h>` resolves. */
function cppExtraArgs(): string[] {
  if (!cppCompiler) return [];
  const dir = bitsIncludeDir(cppCompiler);
  return dir ? ['-I', dir] : [];
}

const cCompiler = firstAvailable(['gcc', 'cc', 'clang']);
const cppCompiler = firstAvailable(['g++', 'clang++', 'c++']);
const javaCompiler = hasBinary('javac') && hasBinary('java') ? 'javac' : null;
const python3 = firstAvailable(['python3', 'python']);
const pypy3 = firstAvailable(['pypy3', 'pypy']);
const goBin = hasBinary('go') ? 'go' : null;
const rustBin = hasBinary('rustc') ? 'rustc' : null;
const nodeBin = hasBinary('node') ? 'node' : null;

export const LANGUAGES: LanguageDef[] = [
  {
    id: 'c',
    name: 'C',
    extension: '.c',
    sourceFile: 'main.c',
    artifact: 'main',
    compile: () => ({ cmd: cCompiler!, args: ['-O2', '-std=c17', '-pipe', '-o', 'main', 'main.c', '-lm'] }),
    run: () => ({ cmd: './main', args: [] }),
    startupGraceMs: 100,
    timeMultiplier: 1,
    memoryOverheadKb: 1024,
    requires: ['gcc'],
    editor: 'c',
    template:
      '#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}\n',
  },
  {
    id: 'cpp',
    name: 'C++',
    extension: '.cpp',
    sourceFile: 'main.cpp',
    artifact: 'main',
    compile: () => ({
      cmd: cppCompiler!,
      args: [...cppExtraArgs(), '-O2', '-std=c++17', '-pipe', '-o', 'main', 'main.cpp'],
    }),
    run: () => ({ cmd: './main', args: [] }),
    startupGraceMs: 100,
    timeMultiplier: 1,
    memoryOverheadKb: 2048,
    requires: ['g++'],
    editor: 'cpp',
    template:
      '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    return 0;\n}\n',
    enabledByDefault: true,
  },
  {
    id: 'cpp14',
    name: 'C++14',
    extension: '.cpp',
    sourceFile: 'main.cpp',
    artifact: 'main',
    compile: () => ({
      cmd: cppCompiler!,
      args: [...cppExtraArgs(), '-O2', '-std=c++14', '-pipe', '-o', 'main', 'main.cpp'],
    }),
    run: () => ({ cmd: './main', args: [] }),
    startupGraceMs: 100,
    timeMultiplier: 1,
    memoryOverheadKb: 2048,
    requires: ['g++'],
    editor: 'cpp',
  },
  {
    id: 'cpp20',
    name: 'C++20',
    extension: '.cpp',
    sourceFile: 'main.cpp',
    artifact: 'main',
    compile: () => ({
      cmd: cppCompiler!,
      args: [...cppExtraArgs(), '-O2', '-std=c++20', '-pipe', '-o', 'main', 'main.cpp'],
    }),
    run: () => ({ cmd: './main', args: [] }),
    startupGraceMs: 100,
    timeMultiplier: 1,
    memoryOverheadKb: 2048,
    requires: ['g++'],
    editor: 'cpp',
  },
  {
    id: 'python3',
    name: 'Python 3',
    extension: '.py',
    sourceFile: 'main.py',
    run: () => ({ cmd: python3!, args: ['-I', 'main.py'] }),
    startupGraceMs: 400,
    timeMultiplier: 3,
    memoryOverheadKb: 4096,
    requires: ['python3'],
    editor: 'python',
    template: 'import sys\n\ndef main():\n    data = sys.stdin.read().split()\n\nif __name__ == "__main__":\n    main()\n',
    enabledByDefault: true,
  },
  {
    id: 'pypy3',
    name: 'PyPy 3',
    extension: '.py',
    sourceFile: 'main.py',
    run: () => ({ cmd: pypy3!, args: ['main.py'] }),
    startupGraceMs: 1500,
    timeMultiplier: 2,
    memoryOverheadKb: 32768,
    requires: ['pypy3'],
    editor: 'python',
  },
  {
    id: 'java',
    name: 'Java',
    extension: '.java',
    sourceFile: 'Main.java',
    artifact: 'Main.class',
    classStyle: true,
    compile: () => ({ cmd: javaCompiler!, args: ['-encoding', 'UTF-8', '-d', '.', 'Main.java'] }),
    run: () => ({ cmd: 'java', args: [] }),
    startupGraceMs: 900,
    timeMultiplier: 2,
    memoryOverheadKb: 16384,
    requires: ['javac'],
    editor: 'java',
    template:
      'import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n        \n    }\n}\n',
  },
  {
    id: 'node',
    name: 'JavaScript (Node.js)',
    extension: '.js',
    sourceFile: 'main.js',
    run: () => ({ cmd: nodeBin!, args: ['main.js'] }),
    startupGraceMs: 400,
    timeMultiplier: 3,
    memoryOverheadKb: 8192,
    requires: ['node'],
    editor: 'javascript',
    template: "const data = require('fs').readFileSync(0, 'utf8');\n",
  },
  {
    id: 'go',
    name: 'Go',
    extension: '.go',
    sourceFile: 'main.go',
    artifact: 'main',
    compile: () => ({ cmd: goBin!, args: ['build', '-o', 'main', 'main.go'] }),
    run: () => ({ cmd: './main', args: [] }),
    startupGraceMs: 200,
    timeMultiplier: 1,
    memoryOverheadKb: 4096,
    requires: ['go'],
    editor: 'go',
    template:
      'package main\n\nimport "fmt"\n\nfunc main() {\n    var n int\n    fmt.Scan(&n)\n    _ = n\n}\n',
  },
  {
    id: 'rust',
    name: 'Rust',
    extension: '.rs',
    sourceFile: 'main.rs',
    artifact: 'main',
    compile: () => ({ cmd: rustBin!, args: ['-O', '-o', 'main', 'main.rs'] }),
    run: () => ({ cmd: './main', args: [] }),
    startupGraceMs: 200,
    timeMultiplier: 1,
    memoryOverheadKb: 2048,
    requires: ['rustc'],
    editor: 'rust',
  },
];

export const AVAILABLE_LANGUAGE_IDS: string[] = LANGUAGES.filter((lang) => {
  if (lang.id === 'java') return Boolean(javaCompiler);
  if (lang.id === 'c') return Boolean(cCompiler);
  if (lang.id.startsWith('cpp')) return Boolean(cppCompiler);
  if (lang.id === 'python3') return Boolean(python3);
  if (lang.id === 'pypy3') return Boolean(pypy3);
  if (lang.id === 'node') return Boolean(nodeBin);
  if (lang.id === 'go') return Boolean(goBin);
  if (lang.id === 'rust') return Boolean(rustBin);
  return true;
}).map((lang) => lang.id);

export function getLanguage(id: string): LanguageDef | undefined {
  return LANGUAGES.find((lang) => lang.id === id);
}

/** Languages that can be used to write checkers / interactors. */
export const SPJ_LANGUAGES = ['cpp', 'cpp17', 'c', 'python3', 'node'];

export function languageAvailable(id: string): boolean {
  return AVAILABLE_LANGUAGE_IDS.includes(id);
}

export function javaRunArgs(memMb: number): string[] {
  return [
    `-Xmx${Math.max(16, Math.floor(memMb * 0.75))}m`,
    `-Xss${Math.min(64, Math.max(8, Math.floor(memMb / 8)))}m`,
    '-XX:+UseSerialGC',
    '-Dfile.encoding=UTF-8',
    '-cp',
    '.',
    'Main',
  ];
}
