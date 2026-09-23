import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export function problemTestdataDir(problemId: number): string {
  return path.join(config.paths.testdata, String(problemId));
}

export interface SavedTestcase {
  inputFile: string;
  outputFile: string;
}

/** Persist one test case into data/testdata/<problemId>/<index>.in|.out */
export function saveTestcase(
  problemId: number,
  index: number,
  input: string,
  output: string,
): SavedTestcase {
  const dir = problemTestdataDir(problemId);
  fs.mkdirSync(dir, { recursive: true });
  const inName = `${index}.in`;
  const outName = `${index}.out`;
  fs.writeFileSync(path.join(dir, inName), input, 'utf8');
  fs.writeFileSync(path.join(dir, outName), output, 'utf8');
  return {
    inputFile: path.join(String(problemId), inName),
    outputFile: path.join(String(problemId), outName),
  };
}

export function readTestcaseFile(relative: string): string {
  const full = path.isAbsolute(relative) ? relative : path.join(config.paths.testdata, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

export function deleteTestcaseFiles(problemId: number, index: number): void {
  const dir = problemTestdataDir(problemId);
  for (const ext of ['in', 'out']) {
    try {
      fs.rmSync(path.join(dir, `${index}.${ext}`), { force: true });
    } catch {
      /* ignore */
    }
  }
}

export function deleteProblemTestdata(problemId: number): void {
  try {
    fs.rmSync(problemTestdataDir(problemId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function uploadDir(sub?: string): string {
  const dir = sub ? path.join(config.paths.uploads, sub) : config.paths.uploads;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function publicUploadPath(relative: string): string {
  return `/uploads/${relative.replace(/\\/g, '/')}`;
}
