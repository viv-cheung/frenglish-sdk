import { Configuration } from "../types/configuration"
import { promisify } from 'util'
import * as fs from 'fs'

const readFileAsync = promisify(fs.readFile)

export async function parsePartialConfig(partialConfig: string | Partial<Configuration> | undefined): Promise<Partial<Configuration> | undefined> {
  if (!partialConfig) {
    return undefined
  }

  if (typeof partialConfig === 'string') {
    try {
      // First try to parse as JSON string
      return JSON.parse(partialConfig)
    } catch {
      try {
        // If parsing fails, try to read it as a file
        const content = await readFileAsync(partialConfig, 'utf8')
        return JSON.parse(content)
      } catch (error) {
        throw new Error(`Failed to parse partialConfig: ${partialConfig}. Must be valid JSON string or path to JSON file. Error: ${error}`)
      }
    }
  }

  return partialConfig
}