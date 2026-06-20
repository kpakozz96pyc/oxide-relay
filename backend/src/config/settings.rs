use std::{fs, net::SocketAddr, path::PathBuf};

use clap::Parser;
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct Settings {
    pub server: ServerSettings,
    pub database: DatabaseSettings,
    pub session: SessionSettings,
    pub bootstrap_admin: BootstrapAdminSettings,
    pub frontend: FrontendSettings,
}

impl Settings {
    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let cli = Cli::parse();
        let file_settings = ConfigFile::from_path(cli.config.as_ref())?;
        Self::from_sources(cli, file_settings, |key| std::env::var(key).ok())
    }

    fn from_sources<F>(
        cli: Cli,
        file_settings: ConfigFile,
        read_env: F,
    ) -> Result<Self, Box<dyn std::error::Error>>
    where
        F: Fn(&str) -> Option<String>,
    {
        let env = |key| read_env(key);

        let host = cli
            .host
            .or_else(|| env("OXIDERELAY_HOST"))
            .or_else(|| {
                file_settings
                    .server
                    .as_ref()
                    .and_then(|server| server.host.clone())
            })
            .unwrap_or_else(|| "127.0.0.1".to_owned());

        let port = cli
            .port
            .or_else(|| env("OXIDERELAY_PORT"))
            .or_else(|| {
                file_settings
                    .server
                    .as_ref()
                    .and_then(|server| server.port.clone())
            })
            .unwrap_or_else(|| "8080".to_owned())
            .parse()?;

        let database_path = cli
            .database_path
            .or_else(|| env("OXIDERELAY_DATABASE_PATH").map(PathBuf::from))
            .or_else(|| {
                file_settings
                    .database
                    .as_ref()
                    .and_then(|database| database.path.clone().map(PathBuf::from))
            })
            .unwrap_or_else(|| PathBuf::from("./data/oxiderelay.sqlite"));

        let session_cookie_name = cli
            .session_cookie_name
            .or_else(|| env("OXIDERELAY_SESSION_COOKIE_NAME"))
            .or_else(|| {
                file_settings
                    .session
                    .as_ref()
                    .and_then(|session| session.cookie_name.clone())
            })
            .unwrap_or_else(|| "oxiderelay_session".to_owned());

        let session_ttl_hours = cli
            .session_ttl_hours
            .or_else(|| env("OXIDERELAY_SESSION_TTL_HOURS"))
            .or_else(|| {
                file_settings
                    .session
                    .as_ref()
                    .and_then(|session| session.ttl_hours.clone())
            })
            .unwrap_or_else(|| "168".to_owned())
            .parse()?;

        let session_cookie_secure = cli
            .session_cookie_secure
            .or_else(|| env("OXIDERELAY_SESSION_COOKIE_SECURE"))
            .or_else(|| {
                file_settings
                    .session
                    .as_ref()
                    .and_then(|session| session.cookie_secure.clone())
            })
            .map(|value| parse_bool_flag(&value))
            .transpose()?
            .unwrap_or(false);

        let admin_email = cli
            .admin_email
            .or_else(|| env("OXIDERELAY_ADMIN_EMAIL"))
            .or_else(|| {
                file_settings
                    .bootstrap_admin
                    .as_ref()
                    .and_then(|admin| admin.email.clone())
            });

        let admin_password = cli
            .admin_password
            .or_else(|| env("OXIDERELAY_ADMIN_PASSWORD"))
            .or_else(|| {
                file_settings
                    .bootstrap_admin
                    .as_ref()
                    .and_then(|admin| admin.password.clone())
            });

        let frontend_dist_path = cli
            .frontend_dist_path
            .or_else(|| env("OXIDERELAY_FRONTEND_DIST_PATH").map(PathBuf::from))
            .or_else(|| {
                file_settings
                    .frontend
                    .as_ref()
                    .and_then(|frontend| frontend.dist_path.clone().map(PathBuf::from))
            })
            .unwrap_or_else(|| PathBuf::from("./frontend/dist"));

        Ok(Self {
            server: ServerSettings { host, port },
            database: DatabaseSettings {
                path: database_path,
            },
            session: SessionSettings {
                cookie_name: session_cookie_name,
                ttl_hours: session_ttl_hours,
                cookie_secure: session_cookie_secure,
            },
            bootstrap_admin: BootstrapAdminSettings {
                email: admin_email,
                password: admin_password,
            },
            frontend: FrontendSettings {
                dist_path: frontend_dist_path,
            },
        })
    }
}

#[derive(Debug, Clone)]
pub struct ServerSettings {
    pub host: String,
    pub port: u16,
}

impl ServerSettings {
    pub fn socket_addr(&self) -> Result<SocketAddr, std::net::AddrParseError> {
        format!("{}:{}", self.host, self.port).parse()
    }
}

#[derive(Debug, Clone)]
pub struct DatabaseSettings {
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct SessionSettings {
    pub cookie_name: String,
    pub ttl_hours: i64,
    pub cookie_secure: bool,
}

#[derive(Debug, Clone)]
pub struct BootstrapAdminSettings {
    pub email: Option<String>,
    pub password: Option<String>,
}

impl BootstrapAdminSettings {
    pub fn is_configured(&self) -> bool {
        self.email.is_some() && self.password.is_some()
    }
}

#[derive(Debug, Clone)]
pub struct FrontendSettings {
    pub dist_path: PathBuf,
}

#[derive(Debug, Parser)]
#[command(name = "oxiderelay-backend")]
#[command(about = "OxideRelay backend service")]
struct Cli {
    #[arg(long)]
    config: Option<PathBuf>,
    #[arg(long)]
    host: Option<String>,
    #[arg(long)]
    port: Option<String>,
    #[arg(long = "database-path")]
    database_path: Option<PathBuf>,
    #[arg(long = "session-cookie-name")]
    session_cookie_name: Option<String>,
    #[arg(long = "session-ttl-hours")]
    session_ttl_hours: Option<String>,
    #[arg(long = "session-cookie-secure")]
    session_cookie_secure: Option<String>,
    #[arg(long = "admin-email")]
    admin_email: Option<String>,
    #[arg(long = "admin-password")]
    admin_password: Option<String>,
    #[arg(long = "frontend-dist-path")]
    frontend_dist_path: Option<PathBuf>,
}

#[derive(Debug, Default, Deserialize)]
struct ConfigFile {
    server: Option<FileServerSettings>,
    database: Option<FileDatabaseSettings>,
    session: Option<FileSessionSettings>,
    bootstrap_admin: Option<FileBootstrapAdminSettings>,
    frontend: Option<FileFrontendSettings>,
}

impl ConfigFile {
    fn from_path(path: Option<&PathBuf>) -> Result<Self, Box<dyn std::error::Error>> {
        let Some(path) = path else {
            return Ok(Self::default());
        };

        let raw = fs::read_to_string(path)?;
        Ok(toml::from_str(&raw)?)
    }
}

#[derive(Debug, Deserialize)]
struct FileServerSettings {
    host: Option<String>,
    port: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileDatabaseSettings {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileSessionSettings {
    cookie_name: Option<String>,
    ttl_hours: Option<String>,
    cookie_secure: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileBootstrapAdminSettings {
    email: Option<String>,
    password: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileFrontendSettings {
    dist_path: Option<String>,
}

fn parse_bool_flag(raw: &str) -> Result<bool, Box<dyn std::error::Error>> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(format!("invalid boolean value: {raw}").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn cli_defaults() -> Cli {
        Cli {
            config: None,
            host: None,
            port: None,
            database_path: None,
            session_cookie_name: None,
            session_ttl_hours: None,
            session_cookie_secure: None,
            admin_email: None,
            admin_password: None,
            frontend_dist_path: None,
        }
    }

    #[test]
    fn source_precedence_is_cli_then_env_then_file_then_default() {
        let cli = Cli {
            host: Some("0.0.0.0".to_owned()),
            port: Some("9090".to_owned()),
            session_cookie_name: Some("cli_cookie".to_owned()),
            session_ttl_hours: Some("72".to_owned()),
            ..cli_defaults()
        };
        let file = ConfigFile {
            server: Some(FileServerSettings {
                host: Some("127.0.0.1".to_owned()),
                port: Some("8080".to_owned()),
            }),
            database: Some(FileDatabaseSettings {
                path: Some("./data/from-file.sqlite".to_owned()),
            }),
            session: Some(FileSessionSettings {
                cookie_name: Some("file_cookie".to_owned()),
                ttl_hours: Some("24".to_owned()),
                cookie_secure: Some("false".to_owned()),
            }),
            bootstrap_admin: Some(FileBootstrapAdminSettings {
                email: Some("file-admin@example.com".to_owned()),
                password: Some("file-secret".to_owned()),
            }),
            frontend: Some(FileFrontendSettings {
                dist_path: Some("./frontend/from-file-dist".to_owned()),
            }),
        };
        let env = BTreeMap::from([
            ("OXIDERELAY_HOST".to_owned(), "10.0.0.1".to_owned()),
            (
                "OXIDERELAY_DATABASE_PATH".to_owned(),
                "./data/from-env.sqlite".to_owned(),
            ),
            (
                "OXIDERELAY_SESSION_COOKIE_SECURE".to_owned(),
                "true".to_owned(),
            ),
            (
                "OXIDERELAY_ADMIN_EMAIL".to_owned(),
                "env-admin@example.com".to_owned(),
            ),
            (
                "OXIDERELAY_FRONTEND_DIST_PATH".to_owned(),
                "./frontend/from-env-dist".to_owned(),
            ),
        ]);

        let settings =
            Settings::from_sources(cli, file, |key| env.get(key).cloned()).expect("settings");

        assert_eq!(settings.server.host, "0.0.0.0");
        assert_eq!(settings.server.port, 9090);
        assert_eq!(
            settings.database.path,
            PathBuf::from("./data/from-env.sqlite")
        );
        assert_eq!(settings.session.cookie_name, "cli_cookie");
        assert_eq!(settings.session.ttl_hours, 72);
        assert!(settings.session.cookie_secure);
        assert_eq!(
            settings.bootstrap_admin.email.as_deref(),
            Some("env-admin@example.com")
        );
        assert_eq!(
            settings.bootstrap_admin.password.as_deref(),
            Some("file-secret")
        );
        assert_eq!(
            settings.frontend.dist_path,
            PathBuf::from("./frontend/from-env-dist")
        );
    }

    #[test]
    fn defaults_apply_when_sources_are_missing() {
        let settings = Settings::from_sources(cli_defaults(), ConfigFile::default(), |_| None)
            .expect("settings");

        assert_eq!(settings.server.host, "127.0.0.1");
        assert_eq!(settings.server.port, 8080);
        assert_eq!(
            settings.database.path,
            PathBuf::from("./data/oxiderelay.sqlite")
        );
        assert_eq!(settings.session.cookie_name, "oxiderelay_session");
        assert_eq!(settings.session.ttl_hours, 168);
        assert!(!settings.session.cookie_secure);
        assert!(!settings.bootstrap_admin.is_configured());
        assert_eq!(
            settings.frontend.dist_path,
            PathBuf::from("./frontend/dist")
        );
    }

    #[test]
    fn boolean_flags_accept_common_values() {
        assert!(parse_bool_flag("true").expect("bool"));
        assert!(parse_bool_flag("1").expect("bool"));
        assert!(!parse_bool_flag("false").expect("bool"));
        assert!(parse_bool_flag("maybe").is_err());
    }
}
