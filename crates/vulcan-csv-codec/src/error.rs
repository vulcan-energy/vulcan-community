// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: Apache-2.0

use std::fmt;

#[derive(Debug, Clone)]
pub struct ParseError {
    pub code: String,
    pub message: String,
    pub line_number: usize,
    #[allow(dead_code)]
    pub section: Option<String>,
    #[allow(dead_code)]
    pub field: Option<String>,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "[{}] {} (line {})",
            self.code, self.message, self.line_number
        )
    }
}

impl std::error::Error for ParseError {}
