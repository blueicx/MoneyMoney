export function curlCommand(platform = process.platform): 'curl.exe' | 'curl' {
  return platform === 'win32' ? 'curl.exe' : 'curl';
}
