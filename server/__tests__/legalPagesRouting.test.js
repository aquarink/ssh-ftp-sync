const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');
}

describe('legal pages public routing and links', () => {
  test('/terms and /privacy are treated as public routes in App routing guard', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("route !== '/terms'");
    expect(app).toContain("route !== '/privacy'");
    expect(app).toContain("if (route === '/terms')");
    expect(app).toContain("if (route === '/privacy')");
  });

  test('links exist in landing footer, login/register page, and in-app account area', () => {
    const app = read('src/App.tsx');
    const landing = read('src/components/LandingPage.tsx');

    expect(landing).toContain("onNavigate('/terms')");
    expect(landing).toContain("onNavigate('/privacy')");

    expect(app).toContain("navigate('/terms')");
    expect(app).toContain("navigate('/privacy')");
    expect(app).toContain('Terms & Conditions');
    expect(app).toContain('Privacy Policy');
  });
});
