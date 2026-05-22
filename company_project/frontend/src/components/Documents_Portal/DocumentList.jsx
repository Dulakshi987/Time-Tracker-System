import { useEffect, useState } from "react";
import { getByType } from "../../services/Documents_Portal/api";

const DocumentList = ({ selectedType }) => {

  const [documents, setDocuments] = useState([]);

  useEffect(() => {

    loadDocuments();

  }, [selectedType]);

  const loadDocuments = async () => {

    try {

      const res = await getByType(selectedType);

      setDocuments(res.data);

    } catch (error) {

      console.log(error);

    }
  };

  return (

    <div className="table-container">

      <h2 className="table-title">
        {selectedType} Documents
      </h2>

      <table className="document-table">

        <thead>

          <tr>
            <th>Job Type</th>
            <th>Reservation No</th>
            <th>Customer Name</th>
            <th>Entered By</th>
            <th>Date</th>
            <th>Time</th>
            <th>Status</th>
          </tr>

        </thead>

        <tbody>

          {documents.map((doc) => (

            <tr key={doc.id}>

              <td>{doc.jobType}</td>
              <td>{doc.reservationNo}</td>
              <td>{doc.customerName}</td>
              <td>{doc.enteredBy}</td>
              <td>{doc.requestDate}</td>
              <td>{doc.requestTime}</td>

              <td className="pending">
                {doc.status}
              </td>

            </tr>

          ))}

        </tbody>

      </table>

    </div>
  );
};

export default DocumentList;