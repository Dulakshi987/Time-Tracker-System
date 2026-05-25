import axios from "axios";

const ExcelUpload = () => {

  const downloadTemplate = () => {

    window.open(
      "http://localhost:8080/api/excel/download-template"
    );

  };

  const handleUpload = async (e) => {

    const file = e.target.files[0];

    const formData = new FormData();

    formData.append("file", file);

    try {

      await axios.post(
        "http://localhost:8080/api/excel/upload",
        formData
      );

      alert("Excel Uploaded Successfully");

    } catch (error) {

      console.log(error);

    }
  };

  // return (

  //   <div className="excel-container">

  //     <button
  //       className="download-btn"
  //       onClick={downloadTemplate}
  //     >
  //       Download Excel Format
  //     </button>

  //     <input
  //       type="file"
  //       accept=".xlsx"
  //       onChange={handleUpload}
  //     />

  //   </div>
  // );
};

export default ExcelUpload;