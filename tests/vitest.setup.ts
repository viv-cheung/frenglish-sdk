import { vi } from 'vitest'


// We mock the .env file for configs
vi.mock('../src/utils/env', () => ({
  default: vi.fn((key) => {
    const mockValues: any = {
      'NODE_ENV': 'test',
      'FRENGLISH_API_KEY': 'mockedGptApiKey',
    }
    return mockValues[key]
  })
}))
