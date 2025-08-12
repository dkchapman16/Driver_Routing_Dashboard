import React from 'react';
import { render } from '@testing-library/react';

jest.mock('../LanesTab', () => ({
  __esModule: true,
  default: () => <div>LanesTab</div>,
}));

import LanesTab from '../LanesTab';

describe('LanesTab dark mode snapshot', () => {
  it('renders correctly', () => {
    const { asFragment } = render(
      <div className="dark">
        <LanesTab />
      </div>
    );
    expect(asFragment()).toMatchSnapshot();
  });
});
