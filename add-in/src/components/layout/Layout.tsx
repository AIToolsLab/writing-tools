import Navbar from '../navbar/Navbar';

export default function Layout({ children }: React.PropsWithChildren<any>) {
	return (
		<>
			<Navbar />

			{ children }
		</>
	);
}
