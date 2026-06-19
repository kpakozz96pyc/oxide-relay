use std::net::SocketAddr;

use oxiderelay_backend::{
    app::AppState, config::Settings, db::initialize as initialize_database, http,
};
use tokio::net::TcpListener;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let settings = Settings::load()?;

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "oxiderelay_backend=info,tower_http=info".to_owned()),
        )
        .with_target(false)
        .compact()
        .init();

    let pool = initialize_database(&settings).await?;
    let app = http::router(AppState::new(pool, settings.session.clone()));
    let address: SocketAddr = settings.server.socket_addr()?;
    let listener = TcpListener::bind(address).await?;

    info!("starting backend on {}", address);
    info!("sqlite database path: {}", settings.database.path.display());
    info!(
        bootstrap_admin_configured = settings.bootstrap_admin.is_configured(),
        "bootstrap admin configuration loaded"
    );

    axum::serve(listener, app).await?;

    Ok(())
}
