/**
 * Webpack configuration for Google Docs Add-on
 * 
 * This creates a single bundled JS file that can be inlined into sidebar.html.
 * Unlike the Word add-in config, this is much simpler.
 */
const path = require('path');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env = {}, options = {}) => {
	const dev = options.mode === 'development';
	
	return {
		devtool: dev ? 'source-map' : false,
		entry: {
			'google-docs': './src/index-gdocs.tsx'
		},
		output: {
			path: path.resolve(__dirname, 'dist-gdocs'),
			filename: '[name].bundle.js',
			clean: true
		},
		resolve: {
			alias: {
				'@': path.resolve(__dirname, 'src')
			},
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.css']
		},
		module: {
			rules: [
				{
					test: /\.tsx?$/,
					exclude: /node_modules/,
					use: ['ts-loader']
				},
				{
					test: /\.css$/,
					use: [
						dev ? 'style-loader' : MiniCssExtractPlugin.loader,
						'css-loader',
						'postcss-loader'
					]
				},
				{
					test: /\.(png|jpg|jpeg|ttf|woff|woff2|gif|ico|svg)$/,
					type: 'asset/inline' // Inline assets as base64 for simplicity
				}
			]
		},
		plugins: [
			new MiniCssExtractPlugin({
				filename: '[name].css'
			}),
			new webpack.DefinePlugin({
				'process.env.AUTH0_DOMAIN': JSON.stringify('dev-rbroo1fvav24wamu.us.auth0.com'),
				'process.env.AUTH0_CLIENT_ID': JSON.stringify('YZhokQZRgE2YUqU5Is9LcaMiCzujoaVr'),
				'process.env.NODE_ENV': JSON.stringify(options.mode || 'development')
			}),
			// Generate a standalone HTML file for testing
			new HtmlWebpackPlugin({
				filename: 'sidebar-bundled.html',
				template: path.resolve(__dirname, '../google-docs-addon/sidebar.html'),
				inject: 'body',
				scriptLoading: 'blocking'
			})
		],
		optimization: {
			// Don't split chunks - we want a single file
			splitChunks: false
		},
		// For development with a local server
		devServer: {
			static: {
				directory: path.resolve(__dirname, 'dist-gdocs')
			},
			port: 3001,
			hot: true,
			allowedHosts: 'all', // Allow ngrok and other external hosts
			headers: {
				'Access-Control-Allow-Origin': '*'
			}
		}
	};
};
